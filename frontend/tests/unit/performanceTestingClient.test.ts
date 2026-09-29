import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPlan, fetchReport, generateScript, startRun, updatePlan } from "../../src/services/performanceTestingClient";
import { planFixture, stubFetch } from "./performanceFixtures";

/** AP-029 contract client (tasks T032). */

const BASE = "/api/test-generation-workflow/performance";

afterEach(() => vi.unstubAllGlobals());

describe("performanceTestingClient", () => {
  it("maps success bodies", async () => {
    stubFetch({ [`GET ${BASE}/plan`]: () => [200, { plan: planFixture(), script: null }] });
    const result = await fetchPlan();
    expect(result).toMatchObject({ ok: true, script: null, plan: { fingerprint: "fp-1" } });
  });

  it("maps contract error extras", async () => {
    stubFetch({
      [`POST ${BASE}/script`]: () => [422, { error: "expected_status_missing", message: "m", stepIds: ["s-status"] }],
      [`PUT ${BASE}/plan`]: () => [400, { error: "dependency_order_violation", message: "m", variable: "orderId" }],
      [`POST ${BASE}/runs`]: () => [409, { error: "k6_unavailable", message: "m", readiness: { state: "unavailable", reason: "not-found", checkedAt: "x" } }],
    });
    expect(await generateScript()).toEqual({ ok: false, error: "expected_status_missing", message: "m", stepIds: ["s-status"] });
    expect(await updatePlan({ stepOrder: {} })).toMatchObject({ ok: false, variable: "orderId" });
    expect(await startRun("env-1")).toMatchObject({ ok: false, readiness: { reason: "not-found" } });
  });

  it("maps AP-033 body-edit error extras", async () => {
    stubFetch({
      [`PUT ${BASE}/plan`]: () => [400, { error: "invalid_body", message: "Not valid JSON at line 1, column 14.", stepId: "s-1", line: 1, column: 14 }],
    });
    expect(await updatePlan({ bodyEdits: { "s-1": { kind: "json", text: '{"quantity": }' } } })).toEqual({
      ok: false,
      error: "invalid_body",
      message: "Not valid JSON at line 1, column 14.",
      stepId: "s-1",
      line: 1,
      column: 14,
    });
  });

  it("ignores extras of the wrong type", async () => {
    stubFetch({ [`PUT ${BASE}/plan`]: () => [400, { error: "body_secret_literal", message: "m", stepId: 3, fieldPath: "pin", line: "2" }] });
    expect(await updatePlan({})).toEqual({ ok: false, error: "body_secret_literal", message: "m", fieldPath: "pin" });
  });

  it("reports a thrown fetch as network_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    expect(await fetchPlan()).toEqual({ ok: false, error: "network_error", message: "offline" });
    expect(await fetchReport("r")).toEqual({ ok: false, error: "network_error", message: "offline" });
  });

  it("returns the report as text", async () => {
    stubFetch({ [`GET ${BASE}/runs/r1/report`]: () => [200, "<!doctype html>"] });
    expect(await fetchReport("r1")).toEqual({ ok: true, html: "<!doctype html>" });
  });
});
