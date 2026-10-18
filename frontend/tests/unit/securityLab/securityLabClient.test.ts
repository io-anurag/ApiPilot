import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editScenario,
  fetchCategories,
  fetchScenario,
  fetchScope,
  generateScenarios,
  isRecord,
  listAllScenarios,
  listScenarioIds,
  listScenarios,
  reviewScenarios,
  scenarioQueryString,
  securityLabRequest,
} from "../../../src/services/securityLabClient";
import { scenarioDetail, scenarioItem, scenarioList } from "./securityFixtures";

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), ...response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("securityLabClient", () => {
  it("returns the validated data for a successful call", async () => {
    stubFetch({ json: async () => ({ edition: "owasp-api-top10-2023", editionTitle: "t", editionSource: "s", taxonomy: [], categories: [] }) });
    const result = await fetchCategories();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.edition).toBe("owasp-api-top10-2023");
  });

  it("calls the Security Lab base path with no-store caching and no body for a GET", async () => {
    const fetchMock = stubFetch({ json: async () => ({ edition: "x", taxonomy: [], categories: [] }) });
    await fetchCategories();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/security-lab/categories");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
  });

  it("sends a JSON body with the content type for a write", async () => {
    const fetchMock = stubFetch({ json: async () => ({}) });
    await securityLabRequest("op", "POST", "/x", isRecord, { a: 1 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("returns the server's error code, safe message, status and details instead of throwing", async () => {
    stubFetch({
      ok: false,
      status: 409,
      json: async () => ({ error: "no_specification", message: "No specification is loaded.", extra: 1 }),
    });
    const result = await fetchCategories();
    expect(result).toEqual({ ok: false, error: "no_specification", message: "No specification is loaded.", status: 409, details: { extra: 1 } });
  });

  it("reports an unreachable service as a network error, never as empty data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await fetchCategories();
    expect(result).toMatchObject({ ok: false, error: "network_error", status: 0 });
  });

  it("rejects a reply that fails validation as invalid_response", async () => {
    stubFetch({ json: async () => ({ unexpected: true }) });
    const result = await fetchCategories();
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("treats a 204 as an empty object", async () => {
    stubFetch({ status: 204, json: async () => { throw new Error("no body"); } });
    const result = await securityLabRequest("op", "DELETE", "/x", isRecord);
    expect(result).toEqual({ ok: true, data: {} });
  });

  it("rethrows an abort so the caller can ignore a superseded request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(fetchCategories()).rejects.toThrow(/aborted/);
  });
});

describe("scenario client", () => {
  const sent = (fetchMock: ReturnType<typeof stubFetch>, index = 0) => {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, init, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
  };

  it("builds a stable query string from only the filters that are set", () => {
    expect(scenarioQueryString({})).toBe("");
    expect(scenarioQueryString({ q: "", operation: undefined })).toBe("");
    expect(scenarioQueryString({ severity: "high", q: "orders", flag: "stale" }, { page: 2, pageSize: 50 })).toBe("?q=orders&severity=high&flag=stale&page=2&pageSize=50");
    expect(scenarioQueryString({ operation: "GET /orders/{id}" })).toBe("?operation=GET+%2Forders%2F%7Bid%7D");
  });

  it("lists scenarios with the filters and paging in the address", async () => {
    const fetchMock = stubFetch({ json: async () => scenarioList([scenarioItem()]) });
    const result = await listScenarios({ reviewState: "draft" }, { page: 3, pageSize: 10 });
    expect(result.ok).toBe(true);
    expect(sent(fetchMock).url).toBe("/api/security-lab/scenarios?reviewState=draft&page=3&pageSize=10");
    expect(sent(fetchMock).init.method).toBe("GET");
  });

  it("resolves the ids a filter matches, without paging", async () => {
    const fetchMock = stubFetch({ json: async () => ({ items: [{ id: "a", version: 1 }], total: 1, capped: false }) });
    const result = await listScenarioIds({ category: "authentication" });
    expect(result).toEqual({ ok: true, data: { items: [{ id: "a", version: 1 }], total: 1, capped: false } });
    expect(sent(fetchMock).url).toBe("/api/security-lab/scenarios/ids?category=authentication");
  });

  it("rejects an ids reply whose items are not id and version pairs", async () => {
    stubFetch({ json: async () => ({ items: [{ id: "a" }], total: 1, capped: false }) });
    expect(await listScenarioIds({})).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("reads every page of a filter and stops at the total", async () => {
    const page = (start: number, count: number, total: number) => ({ ...scenarioList(Array.from({ length: count }, (_, i) => scenarioItem({ id: `s${start + i}` }))), total });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(0, 100, 230) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(100, 100, 230) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page(200, 30, 230) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await listAllScenarios({ severity: "low" });
    expect(result.ok && result.data).toHaveLength(230);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toBe("/api/security-lab/scenarios?severity=low&page=3&pageSize=100");
  });

  it("fails the whole read when one page fails, never returning a partial set as complete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...scenarioList([scenarioItem()]), total: 150 }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "internal_error", message: "Something failed." }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await listAllScenarios({})).toMatchObject({ ok: false, error: "internal_error" });
  });

  it("reads one scenario by an encoded id", async () => {
    const fetchMock = stubFetch({ json: async () => scenarioDetail() });
    await fetchScenario("ss-1/x");
    expect(sent(fetchMock).url).toBe("/api/security-lab/scenarios/ss-1%2Fx");
  });

  it("reads the generation scope and generates with a JSON body", async () => {
    const scopeMock = stubFetch({ json: async () => ({ mode: "selection", selectedCount: 1, totalCount: 9 }) });
    expect(await fetchScope()).toEqual({ ok: true, data: { mode: "selection", selectedCount: 1, totalCount: 9 } });
    expect(sent(scopeMock).url).toBe("/api/security-lab/scope");

    const generateMock = stubFetch({ json: async () => ({ scope: { mode: "all", included: 9, excluded: 0 }, created: 1, kept: 0, newVersions: 0, rejected: [], omittedByCap: [], notes: [] }) });
    await generateScenarios({ scope: { mode: "all" }, categories: ["authentication"] });
    expect(sent(generateMock).url).toBe("/api/security-lab/scenarios/generate");
    expect(sent(generateMock).init.method).toBe("POST");
    expect(sent(generateMock).body).toEqual({ scope: { mode: "all" }, categories: ["authentication"] });
  });

  it("patches a scenario with the expected version and only the changes", async () => {
    const fetchMock = stubFetch({ json: async () => ({ scenarioId: "a", version: 2, material: false, reviewState: "draft", scenario: scenarioDetail() }) });
    const result = await editScenario("ss-1", { expectedVersion: 1, changes: { title: "x" }, note: "n" });
    expect(result.ok).toBe(true);
    expect(sent(fetchMock).url).toBe("/api/security-lab/scenarios/ss-1");
    expect(sent(fetchMock).init.method).toBe("PATCH");
    expect(sent(fetchMock).body).toEqual({ expectedVersion: 1, changes: { title: "x" }, note: "n" });
  });

  it("carries scenario_invalid violations in the failure details", async () => {
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ error: "scenario_invalid", message: "The edited scenario is not valid.", violations: [{ pointer: "/rationale", code: "url_in_content", message: "m" }] }),
    });
    const result = await editScenario("ss-1", { expectedVersion: 1, changes: { rationale: "x" } });
    expect(result).toMatchObject({ ok: false, error: "scenario_invalid", status: 422, details: { violations: [{ pointer: "/rationale" }] } });
  });

  it("reviews an explicit list of items and never a filter", async () => {
    const fetchMock = stubFetch({ json: async () => ({ applied: [], refused: [] }) });
    await reviewScenarios({ action: "approve", items: [{ id: "a", version: 2 }], destructiveConfirmations: ["a"] });
    expect(sent(fetchMock).url).toBe("/api/security-lab/scenarios/review");
    expect(sent(fetchMock).body).toEqual({ action: "approve", items: [{ id: "a", version: 2 }], destructiveConfirmations: ["a"] });
  });
});
