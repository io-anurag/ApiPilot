import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chainRunsClient,
  createPlan,
  debugRun,
  deletePlan,
  discardDebugRun,
  fetchPlan,
  listPlans,
  revealDebugValue,
  savePlan,
  scriptDownloadUrl,
  seedPlan,
  uploadDataSet,
} from "../../src/services/requestChainClient";
import { stubFetch } from "./performanceFixtures";
import { chainPlanFixture, PLAN_ID, viewOf } from "./requestChainFixtures";

/** AP-037 (specs/037-request-chain-performance tasks T022; contracts/chain-plan-api.md). */

const BASE = "/api/chain-plans";

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestChainClient", () => {
  it("maps plan views and lists", async () => {
    const view = viewOf(chainPlanFixture());
    stubFetch({
      [`GET ${BASE}`]: () => [
        200,
        {
          plans: [
            {
              id: PLAN_ID,
              name: "Customer lifecycle",
              chainCount: 1,
              stepCount: 0,
              dataSetCount: 0,
              seedSource: null,
              updatedAt: "t",
            },
          ],
        },
      ],
      [`POST ${BASE}`]: () => [201, view],
      [`GET ${BASE}/${PLAN_ID}`]: () => [200, view],
    });
    expect(await listPlans()).toMatchObject({ ok: true, plans: [{ id: PLAN_ID }] });
    expect(await createPlan("Customer lifecycle")).toEqual({ ok: true, ...view });
    expect(await fetchPlan(PLAN_ID)).toEqual({ ok: true, ...view });
  });

  it("sends the revision and plan on save, and returns moved credentials", async () => {
    const view = viewOf(chainPlanFixture({ revision: 2 }));
    const moved = [
      {
        stepId: "s2",
        location: { kind: "header", name: "Authorization" },
        valueName: "authorization_s2",
        environmentName: "Local",
      },
    ];
    const calls = stubFetch({
      [`PUT ${BASE}/${PLAN_ID}`]: () => [200, { ...view, movedCredentials: moved }],
    });
    const plan = chainPlanFixture();
    const input = { ...plan, chains: [] } as never;
    const result = await savePlan(PLAN_ID, 1, input);
    expect(calls[0].body).toEqual({ revision: 1, plan: input });
    expect(result).toEqual({ ok: true, ...view, movedCredentials: moved });
  });

  it("maps the contract's error details", async () => {
    const current = viewOf(chainPlanFixture({ revision: 5 }));
    stubFetch({
      [`PUT ${BASE}/${PLAN_ID}`]: () => [
        409,
        { error: "plan_revision_conflict", message: "m", current },
      ],
      [`POST ${BASE}/seed`]: () => [
        422,
        {
          error: "credential_needs_environment",
          message: "m",
          stepId: "s2",
          location: { kind: "header", name: "Authorization" },
        },
      ],
      [`DELETE ${BASE}/${PLAN_ID}`]: () => [
        409,
        { error: "run_in_progress", message: "m" },
      ],
    });
    expect(await savePlan(PLAN_ID, 1, {} as never)).toEqual({
      ok: false,
      error: "plan_revision_conflict",
      message: "m",
      current,
    });
    expect(await seedPlan({ name: "x", source: { kind: "specification" } })).toEqual({
      ok: false,
      error: "credential_needs_environment",
      message: "m",
      stepId: "s2",
      location: { kind: "header", name: "Authorization" },
    });
    expect(await deletePlan(PLAN_ID)).toMatchObject({
      ok: false,
      error: "run_in_progress",
    });
  });

  it("treats a 204 as success and a thrown fetch as network_error", async () => {
    stubFetch({ [`DELETE ${BASE}/${PLAN_ID}`]: () => [204, undefined] });
    expect(await deletePlan(PLAN_ID)).toEqual({ ok: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await listPlans()).toEqual({
      ok: false,
      error: "network_error",
      message: "offline",
    });
  });

  it("uploads a data set as multipart and maps a refusal with its line", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "data_set_invalid",
              message: "m",
              reason: "field-count",
              line: 7,
              expected: 6,
              found: 5,
            }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadDataSet(
      PLAN_ID,
      new File(["a,b\n"], "customers.csv"),
      "Customers",
      "row-per-iteration",
    );
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("mode")).toBe("row-per-iteration");
    expect(result).toEqual({
      ok: false,
      error: "data_set_invalid",
      message: "m",
      reason: "field-count",
      line: 7,
      expected: 6,
      found: 5,
    });
  });

  it("builds download URLs and per-plan run calls", async () => {
    expect(scriptDownloadUrl(PLAN_ID, "script")).toBe(
      `${BASE}/${PLAN_ID}/script/download?file=script`,
    );
    const calls = stubFetch({
      [`POST ${BASE}/${PLAN_ID}/runs`]: () => [200, { run: { id: "r1" } }],
      [`GET ${BASE}/${PLAN_ID}/runs`]: () => [200, { runs: [] }],
      [`POST ${BASE}/runs/r1/cancel`]: () => [202, { run: { id: "r1" } }],
      [`GET ${BASE}/readiness`]: () => [
        200,
        { readiness: { state: "ready", version: "1.2.0", checkedAt: "t" } },
      ],
    });
    const runs = chainRunsClient(PLAN_ID);
    expect(await runs.startRun("env-1")).toMatchObject({ ok: true, run: { id: "r1" } });
    expect(calls[0].body).toEqual({ environmentId: "env-1" });
    expect(await runs.fetchRuns()).toEqual({ ok: true, runs: [] });
    expect(await runs.cancelRun("r1")).toMatchObject({ ok: true });
    expect(await runs.fetchReadiness()).toMatchObject({
      ok: true,
      readiness: { state: "ready" },
    });
    expect(runs.reportDownloadUrl("r1")).toBe(`${BASE}/runs/r1/report?download=true`);
  });
});

describe("requestChainClient: Debug run (AP-039)", () => {
  const DEBUG_RUN_ID = "22222222-2222-4222-8222-222222222222";

  it("posts the environment id and maps the masked result", async () => {
    const result = { debugRunId: DEBUG_RUN_ID, outcome: "completed", setup: [], chains: [], notes: [] };
    const calls = stubFetch({ [`POST ${BASE}/${PLAN_ID}/debug-runs`]: () => [200, result] });
    expect(await debugRun(PLAN_ID, "e1")).toMatchObject({ ok: true, result: { debugRunId: DEBUG_RUN_ID, outcome: "completed" } });
    expect(calls[0].body).toEqual({ environmentId: "e1" });
  });

  it("maps a refusal to its code and details", async () => {
    stubFetch({ [`POST ${BASE}/${PLAN_ID}/debug-runs`]: () => [409, { error: "execution_in_progress", message: "Another execution run is in progress in this session.", runId: "r1" }] });
    expect(await debugRun(PLAN_ID, "e1")).toMatchObject({ ok: false, error: "execution_in_progress", runId: "r1" });
  });

  it("reports a cancelled request as aborted and logs no error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("The operation was aborted.", "AbortError"))));
    expect(await debugRun(PLAN_ID, "e1", new AbortController().signal)).toEqual({ ok: false, error: "aborted", message: "Cancelled." });
    expect(error).not.toHaveBeenCalled();
  });

  it("passes the abort signal to the request", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        seen.push(init?.signal);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
      }),
    );
    const controller = new AbortController();
    await debugRun(PLAN_ID, "e1", controller.signal);
    expect(seen[0]).toBe(controller.signal);
  });

  it("reveals one value and discards a run's held values, without storing either", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const calls = stubFetch({
      [`GET ${BASE}/${PLAN_ID}/debug-runs/${DEBUG_RUN_ID}/values/v1`]: () => [200, { value: "Bearer tok-1" }],
      [`DELETE ${BASE}/${PLAN_ID}/debug-runs/${DEBUG_RUN_ID}`]: () => [204, {}],
    });
    expect(await revealDebugValue(PLAN_ID, DEBUG_RUN_ID, "v1")).toEqual({ ok: true, value: "Bearer tok-1" });
    expect(await discardDebugRun(PLAN_ID, DEBUG_RUN_ID)).toEqual({ ok: true });
    expect(calls.map((call) => call.method)).toEqual(["GET", "DELETE"]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("maps an unavailable value to the contract's code", async () => {
    stubFetch({ [`GET ${BASE}/${PLAN_ID}/debug-runs/${DEBUG_RUN_ID}/values/v9`]: () => [404, { error: "debug_value_not_found", message: "That value is not available." }] });
    expect(await revealDebugValue(PLAN_ID, DEBUG_RUN_ID, "v9")).toMatchObject({ ok: false, error: "debug_value_not_found" });
  });
});
