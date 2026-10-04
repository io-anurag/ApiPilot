import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SUPPORTED_DYNAMIC_VARIABLES, type ChainPlan, type ChainStep, type DebugStepOutcome } from "@apipilot/shared-domain";
import { CHAIN_RUNTIME } from "../../../../src/performance/k6/renderChainScript";
import { SandboxAbort, type SandboxRequest, type SandboxResponse } from "../../../fixtures/performance/k6Sandbox";
import { counted, loadChainPlan } from "../../../fixtures/chain/chainSandbox";
import { bodyExtractor, chain, chainPlan, customerLifecyclePlan, step } from "../../../fixtures/chain/chainPlans";
import { debugRun } from "../../../fixtures/chain/debugRun";

/**
 * AP-039 (specs/039-chain-debug-run research R2, tasks T013 and T023): the debug executor is a twin of
 * the k6 runtime's step logic. Each case runs one plan, with one stub responder, through the real
 * generated script in the sandbox and through the executor, and compares what was sent, which
 * extractors succeeded, which checks passed and which steps were skipped. A failure here means the
 * runtime and the executor have drifted apart: fix the twin, or the runtime, and review both.
 */

const BASE = "http://127.0.0.1:4600";
const VALUES: Record<string, string> = { baseUrl: BASE, client_id: "id-1", client_secret: "secret-1" };
const RUN_TAG = "ab12cd";

interface Observed {
  /** `[method, url, body, headers]` of every request, setup first. */
  requests: [string, string, string | null, Record<string, string>][];
  /** `step:extractor:outcome` for every extractor that ran. */
  extractions: string[];
  /** `step:check:outcome`. */
  checks: string[];
  /** The ids of the steps that sent a request, in order. */
  sentSteps: string[];
}

function planOf(...chains: ChainStep[][]): ChainPlan {
  return chainPlan({ chains: chains.map((steps, index) => chain(`c${index + 1}`, `Chain ${index + 1}`, steps)), thinkTimeMs: 0 });
}

function observeSandbox(plan: ChainPlan, values: Record<string, string>, respond: (request: SandboxRequest) => SandboxResponse): { observed: Observed; aborted: boolean } {
  const setupBox = loadChainPlan(plan, { values, respond, vu: 0, runTag: RUN_TAG });
  let data: unknown = { setup: [] };
  let aborted = false;
  try {
    data = setupBox.setup();
  } catch (error) {
    if (!(error instanceof SandboxAbort)) throw error;
    aborted = true;
  }
  const userBox = loadChainPlan(plan, { values, respond, vu: 1, runTag: RUN_TAG });
  if (!aborted) userBox.iterate(data, 0);
  const boxes = aborted ? [setupBox] : [setupBox, userBox];
  const requests = boxes.flatMap((box) => box.requests.map((r): Observed["requests"][number] => [r.method, r.url, r.body, r.headers]));
  const extractions = boxes.flatMap((box) =>
    counted(box, "apipilot_capture").map((tags) => `${tags.step ?? tags.setup_step}:${tags.capture}:${tags.outcome === "ok" ? "extracted" : "failed"}`),
  );
  const checks = boxes.flatMap((box) => counted(box, "apipilot_check").map((tags) => `${tags.step ?? tags.setup_step}:${tags.check}:${tags.outcome}`));
  const sentSteps = boxes.flatMap((box) => box.requests.map((r) => r.tags.step ?? r.tags.setup_step));
  return { observed: { requests, extractions, checks, sentSteps }, aborted };
}

function sentOf(steps: DebugStepOutcome[]) {
  return steps.filter((entry) => entry.status === "sent");
}

async function observeExecutor(plan: ChainPlan, values: Record<string, string>, respond: (request: SandboxRequest) => SandboxResponse): Promise<{ observed: Observed; outcome: string }> {
  const run = await debugRun(plan, { values, respond, runTag: RUN_TAG });
  const all = [...run.result.setup, ...run.result.chains.flatMap((entry) => entry.steps)];
  const sent = sentOf(all);
  const extractions = sent.flatMap((entry) =>
    entry.extractors.map((item) => `${entry.stepId}:${item.name}:${item.outcome.kind === "extracted" ? "extracted" : "failed"}`),
  );
  const checks = sent.flatMap((entry) => entry.checks.map((item) => `${entry.stepId}:${item.checkId}:${item.passed ? "passed" : "failed"}`));
  return {
    observed: {
      requests: run.sent.map((input): Observed["requests"][number] => [input.method, input.url, input.body, input.headers]),
      extractions,
      checks,
      sentSteps: sent.map((entry) => entry.stepId),
    },
    outcome: run.result.outcome,
  };
}

/** `makeRespond` gives each runtime its own responder, so a stateful stub starts fresh for both. */
async function compare(plan: ChainPlan, makeRespond: () => (request: SandboxRequest) => SandboxResponse, values: Record<string, string> = VALUES) {
  const sandbox = observeSandbox(plan, values, makeRespond());
  const executor = await observeExecutor(plan, values, makeRespond());
  expect(executor.observed.requests).toEqual(sandbox.observed.requests);
  expect(executor.observed.sentSteps).toEqual(sandbox.observed.sentSteps);
  expect(executor.observed.checks).toEqual(sandbox.observed.checks);
  // The runtime evaluates extractors of a setup step only until the first failure; the executor
  // evaluates them all to show every reason. Compare the extractors both ran, and the pass/fail verdict.
  const ranInRuntime = new Set(sandbox.observed.extractions);
  for (const entry of sandbox.observed.extractions) expect(executor.observed.extractions).toContain(entry);
  const extraOnlyInExecutor = executor.observed.extractions.filter((entry) => !ranInRuntime.has(entry));
  expect(extraOnlyInExecutor.every((entry) => sandbox.aborted || entry.endsWith(":failed") || entry.endsWith(":extracted"))).toBe(true);
  return { sandbox, executor };
}

/** The customers stub of the runtime tests: tokens and ids issued by count. */
function customers(options: { tokenStatus?: number; tokenField?: string } = {}) {
  let tokens = 0;
  let ids = 0;
  return (request: SandboxRequest): SandboxResponse => {
    const path = request.url.slice(BASE.length).split("?")[0];
    if (path === "/auth/token") {
      if (options.tokenStatus) return { status: options.tokenStatus, body: { error: "no" } };
      tokens += 1;
      return { status: 200, body: { [options.tokenField ?? "access_token"]: `tok-${tokens}` } };
    }
    if (path === "/api/v1/customers" && request.method === "POST") {
      ids += 1;
      return { status: 201, body: { id: `cust-${ids}` } };
    }
    if (request.method === "DELETE") return { status: 204 };
    const id = /\/api\/v1\/customers\/(.+)$/.exec(path)?.[1];
    return { status: 200, body: id ? { id: decodeURIComponent(id), status: "ACTIVE" } : { items: [] } };
  };
}

describe("debug executor parity with the k6 runtime", () => {
  it("sends the same requests for the customer lifecycle, with dynamic values, headers and bodies", async () => {
    const { executor } = await compare(customerLifecyclePlan({ thinkTimeMs: 0 }), () => customers());
    expect(executor.observed.sentSteps).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
    expect(executor.outcome).toBe("completed");
  });

  it("stops the chain the same way when an extractor path is wrong", async () => {
    const { executor } = await compare(customerLifecyclePlan({ thinkTimeMs: 0 }), () => customers({ tokenField: "token" }));
    // The once-before-load step failed, so the whole run ends.
    expect(executor.outcome).toBe("setup-failed");
    expect(executor.observed.sentSteps).toEqual(["s1"]);
  });

  it("ends the run when the setup step returns an unexpected status", async () => {
    const { executor } = await compare(customerLifecyclePlan({ thinkTimeMs: 0 }), () => customers({ tokenStatus: 401 }));
    expect(executor.outcome).toBe("setup-failed");
  });

  it("ends the run when a value a setup step needs is missing", async () => {
    const { sandbox, executor } = await compare(customerLifecyclePlan({ thinkTimeMs: 0 }), () => customers(), { baseUrl: BASE, client_secret: "secret-1" });
    expect(sandbox.aborted).toBe(true);
    expect(executor.outcome).toBe("setup-failed");
    expect(executor.observed.sentSteps).toEqual([]);
  });

  it("cuts a chain short at a failed extractor and still runs the next chain", async () => {
    const plan = planOf(
      [step({ id: "s1", url: "{{baseUrl}}/a", extractors: [bodyExtractor("x1", "thing", "missing.path")] }), step({ id: "s2", url: "{{baseUrl}}/b" })],
      [step({ id: "s3", url: "{{baseUrl}}/c" })],
    );
    const { executor } = await compare(plan, () => () => ({ status: 200, body: { ok: true } }));
    expect(executor.observed.sentSteps).toEqual(["s1", "s3"]);
    expect(executor.outcome).toBe("stopped-early");
  });

  it("does not stop an every-iteration step on an unexpected status, but stops a once-per-virtual-user step", async () => {
    const respond = () => ({ status: 500, body: {} });
    const every = planOf([step({ id: "s1", url: "{{baseUrl}}/a" }), step({ id: "s2", url: "{{baseUrl}}/b" })]);
    expect((await compare(every, () => respond)).executor.observed.sentSteps).toEqual(["s1", "s2"]);
    const once = planOf([step({ id: "s1", url: "{{baseUrl}}/a", runs: "once-per-virtual-user" }), step({ id: "s2", url: "{{baseUrl}}/b" })]);
    const { executor } = await compare(once, () => respond);
    expect(executor.observed.sentSteps).toEqual(["s1"]);
  });

  it("skips a step that needs a missing environment value, alone, and runs the rest", async () => {
    const plan = planOf([
      step({ id: "s1", url: "{{baseUrl}}/a", headers: [{ name: "X-Api-Key", value: "{{api_key}}" }] }),
      step({ id: "s2", url: "{{baseUrl}}/b" }),
    ]);
    const { executor } = await compare(plan, () => () => ({ status: 200, body: {} }), { baseUrl: BASE });
    expect(executor.observed.sentSteps).toEqual(["s2"]);
  });

  it("skips a step that uses a value an earlier cut-short chain never produced", async () => {
    const plan = planOf(
      [step({ id: "s1", url: "{{baseUrl}}/a", extractors: [bodyExtractor("x1", "thing", "nope")] })],
      [step({ id: "s2", url: "{{baseUrl}}/b/{{thing}}" })],
    );
    const { executor } = await compare(plan, () => () => ({ status: 200, body: {} }));
    expect(executor.observed.sentSteps).toEqual(["s1"]);
  });

  it("shares one scope across chains", async () => {
    const plan = planOf(
      [step({ id: "s1", url: "{{baseUrl}}/a", extractors: [bodyExtractor("x1", "thing", "id")] })],
      [step({ id: "s2", url: "{{baseUrl}}/b/{{thing}}" })],
    );
    const { executor } = await compare(plan, () => () => ({ status: 200, body: { id: "abc" } }));
    expect(executor.observed.requests.map((r) => r[1])).toEqual([`${BASE}/a`, `${BASE}/b/abc`]);
  });

  it("extracts from headers and from array positions, and fails on non-scalar or empty values", async () => {
    const plan = planOf([
      step({
        id: "s1",
        url: "{{baseUrl}}/a",
        extractors: [bodyExtractor("x1", "first", "items[0].id"), { id: "x2", name: "loc", source: { kind: "header", name: "Location" } }, bodyExtractor("x3", "obj", "items[0]"), bodyExtractor("x4", "empty", "blank"), bodyExtractor("x5", "flag", "ok")],
      }),
    ]);
    const respond = () => ({ status: 200, headers: { Location: "/x/1" }, body: { items: [{ id: 7 }], blank: "", ok: true } });
    const { executor } = await compare(plan, () => respond);
    expect(executor.observed.extractions).toEqual(["s1:first:extracted", "s1:loc:extracted", "s1:obj:failed", "s1:empty:failed", "s1:flag:extracted"]);
  });

  it("evaluates every kind of check the same way", async () => {
    const plan = planOf([
      step({
        id: "s1",
        url: "{{baseUrl}}/a",
        checks: [
          { id: "k1", kind: "field-exists", path: "a.b" },
          { id: "k2", kind: "field-equals", path: "a.b", expected: { type: "number", value: 3 } },
          { id: "k3", kind: "field-equals", path: "name", expected: { type: "text", value: "Ada" } },
          { id: "k4", kind: "body-contains", text: "Ada" },
          { id: "k5", kind: "time-at-most", maxMs: 100 },
          { id: "k6", kind: "field-equals", path: "on", expected: { type: "boolean", value: true } },
          { id: "k7", kind: "field-exists", path: "gone" },
        ],
      }),
    ]);
    await compare(plan, () => () => ({ status: 200, durationMs: 250, body: { a: { b: 3 }, name: "Ada", on: true } }));
  });

  it("builds query strings, form bodies and the content type the same way", async () => {
    const plan = planOf([
      step({
        id: "s1",
        method: "POST",
        url: "{{baseUrl}}/a",
        query: [{ name: "q q", value: "a&b {{client_id}}" }],
        body: { kind: "form", fields: [{ name: "n", value: "{{client_id}} é" }] },
      }),
      step({ id: "s2", method: "POST", url: "{{baseUrl}}/b", body: { kind: "raw", contentType: "application/json", text: '{"v":"{{client_secret}}"}' } }),
      step({ id: "s3", method: "POST", url: "{{baseUrl}}/c", headers: [{ name: "content-type", value: "text/plain" }], body: { kind: "raw", contentType: "application/json", text: "x {{client_id}}" } }),
    ]);
    await compare(plan, () => () => ({ status: 200, body: {} }));
  });

  it("generates every supported dynamic variable the same way, in setup and in the iteration", async () => {
    const names = [...SUPPORTED_DYNAMIC_VARIABLES].sort();
    const withAll = (id: string, runs: ChainStep["runs"]) => step({ id, url: "{{baseUrl}}/d", runs, query: names.map((name, index) => ({ name: `p${index}`, value: `{{${name}}}-{{${name}}}` })) });
    const plan = planOf([withAll("s1", "once-before-load"), withAll("s2", "every-iteration")]);
    const { sandbox, executor } = await compare(plan, () => () => ({ status: 200, body: {} }));
    expect(executor.observed.requests).toHaveLength(2);
    expect(sandbox.observed.requests[0][1]).not.toBe(sandbox.observed.requests[1][1]);
    expect(names.length).toBeGreaterThan(40);
  });

  it("uses the run tag in unique values", async () => {
    const plan = planOf([step({ id: "s1", url: "{{baseUrl}}/a", query: [{ name: "e", value: "{{$randomEmail}}" }, { name: "u", value: "{{$guid}}" }] })]);
    const { executor } = await compare(plan, () => () => ({ status: 200, body: {} }));
    expect(executor.observed.requests[0][1]).toContain(RUN_TAG);
  });
});

describe("the k6 runtime has not changed unseen", () => {
  it("keeps the runtime text the executor was written against", () => {
    // If this fails, CHAIN_RUNTIME changed. Review `backend/src/performance/chain/debug/*` against the change,
    // extend the parity cases above, then update this hash. The Debug run must behave as the load run does.
    const hash = createHash("sha256").update(CHAIN_RUNTIME).digest("hex");
    expect(hash).toBe(EXPECTED_RUNTIME_HASH);
  });
});

const EXPECTED_RUNTIME_HASH = "baa45ced8a2b1878a44d4097758e7326df387a1f717ab34a3dff7ca0f10cb2eb";
