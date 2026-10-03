import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReportFrom, json, request } from "../../src/services/performanceTestingClient";
import { stubFetch } from "./performanceFixtures";

/**
 * The request and error handling the performance clients share (AP-029 tasks T032; since AP-037
 * phase two used by request-chain plans, legacy runs and user scripts).
 */

const BASE = "/api/chain-plans";

afterEach(() => vi.unstubAllGlobals());

describe("performanceTestingClient", () => {
  it("maps success bodies", async () => {
    stubFetch({ [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] });
    expect(await request("fetchReadiness", `${BASE}/readiness`, undefined, (body) => ({ readiness: body.readiness }))).toEqual({
      ok: true,
      readiness: { state: "ready", version: "1.2.0", checkedAt: "x" },
    });
  });

  it("maps contract error extras", async () => {
    stubFetch({
      [`POST ${BASE}/p1/runs`]: () => [409, { error: "k6_unavailable", message: "m", readiness: { state: "unavailable", reason: "not-found", checkedAt: "x" } }],
      [`PUT ${BASE}/p1`]: () => [422, { error: "invalid_step", message: "Line 1", stepId: "s3", field: "headers", line: 1, column: 14 }],
    });
    expect(await request("startRun", `${BASE}/p1/runs`, json("POST", { environmentId: "e1" }), () => ({}))).toMatchObject({ ok: false, readiness: { reason: "not-found" } });
    expect(await request("savePlan", `${BASE}/p1`, json("PUT", {}), () => ({}))).toEqual({ ok: false, error: "invalid_step", message: "Line 1", stepId: "s3", field: "headers", line: 1, column: 14 });
  });

  it("ignores extras of the wrong type", async () => {
    stubFetch({ [`PUT ${BASE}/p1`]: () => [400, { error: "invalid_step", message: "m", stepId: 3, field: "headers", line: "2" }] });
    expect(await request("savePlan", `${BASE}/p1`, json("PUT", {}), () => ({}))).toEqual({ ok: false, error: "invalid_step", message: "m", field: "headers" });
  });

  it("reports a thrown fetch as network_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    expect(await request("fetchPlans", BASE, undefined, () => ({}))).toEqual({ ok: false, error: "network_error", message: "offline" });
    expect(await fetchReportFrom(BASE, "r")).toEqual({ ok: false, error: "network_error", message: "offline" });
  });

  it("returns the report as text", async () => {
    stubFetch({ [`GET ${BASE}/runs/r1/report`]: () => [200, "<!doctype html>"] });
    expect(await fetchReportFrom(BASE, "r1")).toEqual({ ok: true, html: "<!doctype html>" });
  });
});
