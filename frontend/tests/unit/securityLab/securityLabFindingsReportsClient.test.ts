import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAllRetainedData,
  deleteAssessment,
  downloadReport,
  exportSecurityPostman,
  fetchFinding,
  fetchFindingEvidence,
  fetchOverview,
  fetchReport,
  fetchRetainedData,
  findingQueryString,
  listFindings,
  patchFinding,
  suggestScenarios,
} from "../../../src/services/securityLabClient";
import { evidenceRecord, exportReply, finding, findingList, overview, retainedData, securityReport, suggestReply } from "./securityFixtures";

function stubFetch(response: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), ...response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
};

afterEach(() => vi.unstubAllGlobals());

describe("findings client (T124)", () => {
  it("builds a stable query string from only the filters that are set", () => {
    expect(findingQueryString({})).toBe("");
    expect(findingQueryString({ status: undefined, operation: "" })).toBe("");
    expect(findingQueryString({ unreviewed: true, severity: "high", operation: "GET /orders" }, { page: 2, pageSize: 10 })).toBe("?severity=high&operation=GET+%2Forders&unreviewed=true&page=2&pageSize=10");
    expect(findingQueryString({ unreviewed: false })).toBe("?unreviewed=false");
  });

  it("lists findings with the filters and paging in the address", async () => {
    const list = findingList([finding()]);
    const fetchMock = stubFetch({ json: async () => list });
    expect(await listFindings({ status: "open", scenario: "ss-1" }, { page: 1, pageSize: 25 })).toEqual({ ok: true, data: list });
    expect(sent(fetchMock)).toMatchObject({ url: "/api/security-lab/findings?status=open&scenario=ss-1&page=1&pageSize=25", method: "GET" });
  });

  it("rejects a list whose items are not findings", async () => {
    stubFetch({ json: async () => ({ items: [{ id: 1 }], total: 1, page: 1, pageSize: 25, counts: {} }) });
    expect(await listFindings({})).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("reads one finding and the evidence of one occurrence, with encoded ids", async () => {
    const one = stubFetch({ json: async () => finding() });
    expect((await fetchFinding("sf/1")).ok).toBe(true);
    expect(sent(one).url).toBe("/api/security-lab/findings/sf%2F1");

    const evidence = stubFetch({ json: async () => ({ available: true, records: [evidenceRecord()] }) });
    expect((await fetchFindingEvidence("sf-1", "res 1")).ok).toBe(true);
    expect(sent(evidence).url).toBe("/api/security-lab/findings/sf-1/occurrences/res%201/evidence");
  });

  it("patches a finding with the status, severity and note, and carries invalid_finding_update", async () => {
    const ok = stubFetch({ json: async () => finding({ status: "resolved" }) });
    await patchFinding("sf-1", { status: "resolved", note: "Fixed" });
    expect(sent(ok)).toEqual({ url: "/api/security-lab/findings/sf-1", method: "PATCH", body: { status: "resolved", note: "Fixed" } });

    stubFetch({ ok: false, status: 422, json: async () => ({ error: "invalid_finding_update", message: "A status change needs a note saying why." }) });
    expect(await patchFinding("sf-1", { status: "resolved" })).toEqual({ ok: false, error: "invalid_finding_update", message: "A status change needs a note saying why.", status: 422, details: {} });
  });
});

describe("overview, report and retained data client (T133, T134, T135)", () => {
  it("reads the overview", async () => {
    const fetchMock = stubFetch({ json: async () => overview() });
    expect(await fetchOverview()).toEqual({ ok: true, data: overview() });
    expect(sent(fetchMock)).toMatchObject({ url: "/api/security-lab/overview", method: "GET" });
  });

  it("rejects an overview that lacks its counts", async () => {
    stubFetch({ json: async () => ({ specificationLoaded: true }) });
    expect(await fetchOverview()).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("reads the report as JSON data, narrowed to runs when asked", async () => {
    const all = stubFetch({ json: async () => securityReport() });
    expect((await fetchReport()).ok).toBe(true);
    expect(sent(all).url).toBe("/api/security-lab/report?format=json");
    const some = stubFetch({ json: async () => securityReport() });
    await fetchReport(["run-1", "run-2"]);
    expect(sent(some).url).toBe("/api/security-lab/report?format=json&runIds=run-1%2Crun-2");
  });

  it("carries nothing_to_report as a refusal with its message", async () => {
    stubFetch({ ok: false, status: 409, json: async () => ({ error: "nothing_to_report", message: "There is nothing to report yet." }) });
    expect(await fetchReport()).toEqual({ ok: false, error: "nothing_to_report", message: "There is nothing to report yet.", status: 409, details: {} });
  });

  it("downloads the report as a file named by the server", async () => {
    const blob = new Blob(["<html></html>"], { type: "text/html" });
    const fetchMock = stubFetch({ blob: async () => blob, headers: new Headers({ "Content-Disposition": 'attachment; filename="security-report-orders.html"' }) });
    const result = await downloadReport("html", ["run-1"]);
    expect(result).toEqual({ ok: true, data: { blob, fileName: "security-report-orders.html" } });
    expect(sent(fetchMock)).toMatchObject({ url: "/api/security-lab/report?format=html&runIds=run-1", method: "GET" });
  });

  it("names the file itself when the server sent no name", async () => {
    stubFetch({ blob: async () => new Blob(["{}"]), headers: new Headers() });
    expect(await downloadReport("json")).toMatchObject({ ok: true, data: { fileName: "security-report.json" } });
  });

  it("turns a refused download into a message, not a broken file", async () => {
    stubFetch({ ok: false, status: 409, json: async () => ({ error: "nothing_to_report", message: "There is nothing to report yet." }), headers: new Headers() });
    expect(await downloadReport("html")).toMatchObject({ ok: false, error: "nothing_to_report", status: 409 });
  });

  it("reports an unreachable service on download as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await downloadReport("html")).toMatchObject({ ok: false, error: "network_error", status: 0 });
  });

  it("reads the retained data", async () => {
    const fetchMock = stubFetch({ json: async () => retainedData() });
    expect(await fetchRetainedData()).toEqual({ ok: true, data: retainedData() });
    expect(sent(fetchMock)).toMatchObject({ url: "/api/security-lab/data", method: "GET" });
  });

  it("deletes an assessment with its typed label, and everything with DELETE ALL, treating the 204 as success", async () => {
    const one = stubFetch({ status: 204, json: async () => { throw new Error("no body"); } });
    expect(await deleteAssessment("k 1", "Orders API · orders.yaml")).toEqual({ ok: true, data: {} });
    expect(sent(one)).toEqual({ url: "/api/security-lab/assessments/k%201", method: "DELETE", body: { confirm: "Orders API · orders.yaml" } });

    const all = stubFetch({ status: 204, json: async () => { throw new Error("no body"); } });
    expect(await deleteAllRetainedData("DELETE ALL")).toEqual({ ok: true, data: {} });
    expect(sent(all)).toEqual({ url: "/api/security-lab/data", method: "DELETE", body: { confirm: "DELETE ALL" } });
  });

  it("carries a refused delete's code, status and message", async () => {
    stubFetch({ ok: false, status: 422, json: async () => ({ error: "confirmation_mismatch", message: "Type DELETE ALL exactly to delete everything.", expected: "DELETE ALL" }) });
    expect(await deleteAllRetainedData("delete all")).toEqual({
      ok: false,
      error: "confirmation_mismatch",
      message: "Type DELETE ALL exactly to delete everything.",
      status: 422,
      details: { expected: "DELETE ALL" },
    });
  });
});

describe("export and suggestion client (T145, T153)", () => {
  it("reads the export with no query when no base address is given, and with an encoded one when it is", async () => {
    const plain = stubFetch({ json: async () => exportReply() });
    expect(await exportSecurityPostman()).toEqual({ ok: true, data: exportReply() });
    expect(sent(plain)).toMatchObject({ url: "/api/security-lab/export/postman", method: "GET" });

    const blank = stubFetch({ json: async () => exportReply() });
    await exportSecurityPostman("   ");
    expect(sent(blank).url).toBe("/api/security-lab/export/postman");

    const withBase = stubFetch({ json: async () => exportReply() });
    await exportSecurityPostman(" https://qa.example.test/api ");
    expect(sent(withBase).url).toBe("/api/security-lab/export/postman?baseUrl=https%3A%2F%2Fqa.example.test%2Fapi");
  });

  it("rejects an export reply that lacks the files or the excluded list", async () => {
    stubFetch({ json: async () => ({ collection: {}, environment: {}, readme: "x", limitations: [], summary: {} }) });
    expect(await exportSecurityPostman()).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("carries a refused export's code and the generator's problems", async () => {
    stubFetch({ ok: false, status: 422, json: async () => ({ error: "export_failed", message: "The collection did not pass validation.", failureCode: "collection_validation_failed", problems: ["item[0].id is not unique"] }) });
    expect(await exportSecurityPostman()).toEqual({
      ok: false,
      error: "export_failed",
      message: "The collection did not pass validation.",
      status: 422,
      details: { failureCode: "collection_validation_failed", problems: ["item[0].id is not unique"] },
    });
    stubFetch({ ok: false, status: 409, json: async () => ({ error: "no_approved_scenarios", message: "There are no approved scenarios to export." }) });
    expect(await exportSecurityPostman()).toMatchObject({ ok: false, error: "no_approved_scenarios", status: 409 });
  });

  it("asks for suggestions with an empty body by default, or the operations and categories given", async () => {
    const none = stubFetch({ json: async () => suggestReply() });
    expect(await suggestScenarios()).toEqual({ ok: true, data: suggestReply() });
    expect(sent(none)).toEqual({ url: "/api/security-lab/scenarios/suggest", method: "POST", body: {} });

    const some = stubFetch({ json: async () => suggestReply() });
    await suggestScenarios({ operationKeys: ["GET /orders"], categories: ["authentication"] });
    expect(sent(some).body).toEqual({ operationKeys: ["GET /orders"], categories: ["authentication"] });
  });

  it("rejects a suggestion reply that is not a list of accepted and rejected suggestions", async () => {
    stubFetch({ json: async () => ({ accepted: [] }) });
    expect(await suggestScenarios()).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("carries ai_unavailable with the readiness reason", async () => {
    stubFetch({ ok: false, status: 503, json: async () => ({ error: "ai_unavailable", message: "The local AI model is unavailable: Model failed to load.", readiness: { state: "unavailable", reason: "Model failed to load." } }) });
    expect(await suggestScenarios()).toEqual({
      ok: false,
      error: "ai_unavailable",
      message: "The local AI model is unavailable: Model failed to load.",
      status: 503,
      details: { readiness: { state: "unavailable", reason: "Model failed to load." } },
    });
  });
});
