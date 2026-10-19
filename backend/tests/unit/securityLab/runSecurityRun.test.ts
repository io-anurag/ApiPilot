import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel, SecurityProfile, SecurityRun } from "@apipilot/shared-domain";
import { getSecurityEvidenceRepository } from "../../../src/persistence/securityEvidenceRepository";
import { getSecurityFindingRepository } from "../../../src/persistence/securityFindingRepository";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { getSecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { pendingEvaluator } from "../../../src/securityLab/evaluation/pendingEvaluator";
import type { Evaluator } from "../../../src/securityLab/evaluation/types";
import { Budget, runSecurityRun, type RunServiceDeps } from "../../../src/securityLab/execution/runSecurityRun";
import type { PlannedExecution } from "../../../src/securityLab/execution/runPlanner";
import type { OutboundRequest, SendOptions, SendOutcome, Sender } from "../../../src/securityLab/execution/types";
import { contentHashOf } from "../../../src/securityLab/scenarios/scenarioIdentity";
import { OWNER_A, T0, makeRun } from "../../fixtures/securityLab/builders";
import { ALICE_TOKEN, BOB_TOKEN, fixtureCredential, fullProfile, generatedScenarios, pick, sampleModel, seedGenerated, type GeneratedFixture } from "../../fixtures/securityLab/runFixtures";
import { ALL_SECRETS, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

const SESSION = "session-run-test";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Handler = (request: OutboundRequest, options: SendOptions, call: number) => Promise<SendOutcome> | SendOutcome;

/** A scripted sender: records every call, how many were in flight at once, and answers from a handler. */
class FakeSender implements Sender {
  readonly calls: OutboundRequest[] = [];
  readonly signals: AbortSignal[] = [];
  inFlight = 0;
  peak = 0;
  constructor(private readonly handler: Handler = () => ok(200, "{}")) {}

  async send(request: OutboundRequest, options: SendOptions): Promise<SendOutcome> {
    this.calls.push(request);
    if (options.signal) this.signals.push(options.signal);
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      return await this.handler(request, options, this.calls.length);
    } finally {
      this.inFlight -= 1;
    }
  }
}

function ok(status: number, bodyText: string, headers: Record<string, string> = {}): SendOutcome {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    bodyText,
    truncated: false,
    durationMs: 3,
    destination: { host: "127.0.0.1", port: 4700, addressClass: "loopback", verdict: "allowed" },
    redirects: [],
    requestsSent: 1,
  };
}

const blockedOutcome = (reason: string): SendOutcome => ({
  headers: {},
  bodyText: "",
  truncated: false,
  durationMs: 0,
  destination: { host: "10.0.0.5", port: 80, addressClass: "private", verdict: "blocked", reason },
  redirects: [],
  requestsSent: 0,
  error: { category: "blocked" },
});

const failedOutcome = (category: "timeout" | "connect" | "tls" | "aborted"): SendOutcome => ({ ...ok(200, ""), status: undefined, requestsSent: 1, error: { category } });

let model: ApiModel;
let scenarios: GeneratedFixture[];
let clock = 0;

beforeEach(async () => {
  model = await sampleModel();
  scenarios = generatedScenarios(model, fullProfile());
  clock = 0;
});

function deps(sender: Sender, evaluator: Evaluator = pendingEvaluator): RunServiceDeps {
  let id = 0;
  return {
    sender,
    evaluator,
    now: () => new Date(Date.parse(T0) + clock++ * 1_000),
    newId: () => `id-${++id}`,
    runs: getSecurityRunRepository(),
    scenarios: getSecurityScenarioRepository(),
    evidence: getSecurityEvidenceRepository(),
    findings: getSecurityFindingRepository(),
  };
}

/** Seeds approved scenarios (a distinct id per entry, the same content) and returns the matching plan. */
function plan(entries: Array<{ id: string; scenario: GeneratedFixture; cleanup?: number }>): PlannedExecution[] {
  return entries.map(({ id, scenario, cleanup }) => {
    seedGenerated(getSecurityScenarioRepository(), model, { id, content: scenario.content });
    return { scenarioId: id, version: 1, content: scenario.content, contentHash: contentHashOf(scenario.content), plannedRequests: scenario.content.plannedRequestCount, cleanupRequests: cleanup ?? 0 };
  });
}

function startRow(planned: readonly PlannedExecution[], maxRequests = 100, maxConcurrency = 1): SecurityRun {
  const run = makeRun({
    id: "run-under-test",
    ownerId: OWNER_A,
    sessionId: SESSION,
    status: "in-progress",
    limits: { maxRequests, maxConcurrency, timeoutMs: 5_000 },
    plan: planned.map((entry) => ({ scenarioId: entry.scenarioId, version: 1, plannedRequests: entry.plannedRequests })),
    budget: { planned: planned.reduce((sum, entry) => sum + entry.plannedRequests + entry.cleanupRequests, 0), used: 0 },
  });
  getSecurityRunRepository().createRun(run);
  return run;
}

interface Execute {
  readonly sender: FakeSender;
  readonly evaluator?: Evaluator;
  readonly profile?: SecurityProfile;
  readonly maxRequests?: number;
  readonly maxConcurrency?: number;
  readonly signal?: AbortSignal;
  readonly credential?: typeof fixtureCredential;
}

async function execute(planned: PlannedExecution[], options: Execute) {
  const run = startRow(planned, options.maxRequests, options.maxConcurrency);
  const profile = options.profile ?? fullProfile();
  await runSecurityRun(deps(options.sender, options.evaluator), {
    run,
    planned,
    profile,
    environment: { tier: "local", baseUrl: "http://127.0.0.1:4700" },
    apiModel: model,
    limits: run.limits,
    credential: options.credential ?? fixtureCredential,
    signal: options.signal ?? new AbortController().signal,
  });
  const settled = getSecurityRunRepository().getRun(OWNER_A, run.id) as SecurityRun;
  return { run: settled, results: getSecurityRunRepository().listResults(OWNER_A, run.id) };
}

const outcomes = (results: Array<{ outcome: string }>) => results.map((result) => result.outcome);

describe("the budget never overshoots, whatever the concurrency (SC-007)", () => {
  it("sends exactly the budget with concurrency 4 against a budget of 10, and records the rest as not run", async () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const planned = plan(Array.from({ length: 12 }, (_, index) => ({ id: `ss-${index}`, scenario: omit })));
    const sender = new FakeSender(async () => {
      await sleep(15);
      return ok(401, "{}");
    });
    const { run, results } = await execute(planned, { sender, maxRequests: 10, maxConcurrency: 4 });
    expect(sender.calls).toHaveLength(10);
    expect(sender.peak).toBeLessThanOrEqual(4);
    expect(sender.peak).toBeGreaterThan(1);
    expect(run.budget.used).toBe(10);
    expect(results).toHaveLength(12);
    expect(results.filter((result) => result.outcome === "not_run")).toHaveLength(2);
    expect(results.filter((result) => result.outcome === "not_run").every((result) => /budget/.test(result.reason))).toBe(true);
    expect(run.status).toBe("completed");
  });

  it("counts every redirect hop against the same budget", async () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const planned = plan([{ id: "ss-a", scenario: omit }, { id: "ss-b", scenario: omit }]);
    const sender = new FakeSender((_request, options) => {
      // The first scenario follows two redirect hops, so it uses 3 of the budget of 3.
      const hop1 = options.reserveHop();
      const hop2 = options.reserveHop();
      return { ...ok(200, "{}"), requestsSent: 1 + Number(hop1) + Number(hop2) };
    });
    const { run, results } = await execute(planned, { sender, maxRequests: 3 });
    expect(run.budget.used).toBe(3);
    expect(outcomes(results)).toEqual(["inconclusive", "not_run"]);
  });

  it("holds the cleanup allowance back from the scenarios and lets cleanup use it", () => {
    const budget = new Budget(5, 2);
    const scenario = Array.from({ length: 6 }, () => budget.reserveScenario());
    expect(scenario).toEqual([true, true, true, false, false, false]);
    expect(budget.reserveCleanup()).toBe(true);
    expect(budget.reserveCleanup()).toBe(true);
    expect(budget.reserveCleanup()).toBe(false);
    expect(budget.used).toBe(5);
  });

  it("never retries a request that failed", async () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const sender = new FakeSender(() => failedOutcome("timeout"));
    const { results } = await execute(plan([{ id: "ss-a", scenario: omit }]), { sender });
    expect(sender.calls).toHaveLength(1);
    expect(outcomes(results)).toEqual(["errored"]);
  });
});

describe("outcomes are never converted to a pass", () => {
  const omit = () => pick(scenarios, "GET /orders", "auth.omit");

  it("records a blocked destination as blocked, with the reason, and does not call the evaluator", async () => {
    let evaluated = 0;
    const sender = new FakeSender(() => blockedOutcome("restricted_address_blocked"));
    const { results } = await execute(plan([{ id: "ss-a", scenario: omit() }]), { sender, evaluator: (execution) => (evaluated++, pendingEvaluator(execution)) });
    expect(results[0]).toMatchObject({ outcome: "blocked", evidenceCount: 1 });
    expect(results[0].reason).toMatch(/non-public|loopback|private/i);
    expect(evaluated).toBe(0);
  });

  it("records a redirect the policy blocked as blocked, even though a response arrived", async () => {
    const sender = new FakeSender(() => ({ ...ok(302, ""), redirects: [{ to: "http://evil.test/x", verdict: "blocked", reason: "host_not_allowed" }] }));
    const { results } = await execute(plan([{ id: "ss-a", scenario: omit() }]), { sender });
    expect(results[0].outcome).toBe("blocked");
    expect(results[0].reason).toMatch(/allowed hosts/);
  });

  it("does not call a redirect that ran out of budget blocked: the response is evaluated", async () => {
    const sender = new FakeSender(() => ({ ...ok(302, ""), redirects: [{ to: "http://127.0.0.1:4700/next", verdict: "blocked", reason: "budget_exhausted" }] }));
    const { results } = await execute(plan([{ id: "ss-a", scenario: omit() }]), { sender });
    expect(results[0].outcome).toBe("inconclusive");
  });

  it.each(["timeout", "connect", "tls"] as const)("records a %s failure as errored, naming the category, and keeps the evidence", async (category) => {
    const sender = new FakeSender(() => failedOutcome(category));
    const { results } = await execute(plan([{ id: "ss-a", scenario: omit() }]), { sender });
    expect(results[0]).toMatchObject({ outcome: "errored", evidenceCount: 1 });
    expect(results[0].reason).toContain(category);
  });

  it("records a scenario whose request cannot be built as blocked, without sending anything", async () => {
    const sender = new FakeSender();
    const expired = pick(scenarios, "GET /orders", "auth.expired");
    const { results } = await execute(plan([{ id: "ss-a", scenario: expired }]), { sender, credential: () => undefined });
    expect(results[0].outcome).toBe("blocked");
    expect(sender.calls).toEqual([]);
  });

  it("hands only a scenario that returned responses to the evaluator, with every response in order", async () => {
    const repeat = { ...omit(), content: { ...omit().content, mutations: [{ kind: "request.repeat" as const, count: 3 }], plannedRequestCount: 3 } };
    const seen: number[] = [];
    const sender = new FakeSender((_request, _options, call) => ok(call < 3 ? 200 : 429, `{"n":${call}}`));
    const { results } = await execute(plan([{ id: "ss-a", scenario: repeat }]), {
      sender,
      evaluator: (execution) => {
        seen.push(...execution.responses.map((response) => response.status));
        expect(execution.plannedRequests).toBe(3);
        return { outcome: "passed", reason: "Judged.", conditionResults: [], observed: { responseStatus: 429, responseHeadersSelected: {}, statement: "Status 429.", truncated: false } };
      },
    });
    expect(seen).toEqual([200, 200, 429]);
    expect(sender.calls).toHaveLength(3);
    expect(results[0]).toMatchObject({ outcome: "passed", reason: "Judged.", evidenceCount: 3 });
  });

  it("keeps the run valid when the evaluator throws: the scenario is recorded as not judged", async () => {
    const sender = new FakeSender();
    const { run, results } = await execute(plan([{ id: "ss-a", scenario: omit() }]), {
      sender,
      evaluator: () => {
        throw new Error("boom with sl-secret");
      },
    });
    expect(run.status).toBe("completed");
    expect(results[0]).toMatchObject({ outcome: "inconclusive" });
    expect(JSON.stringify(results)).not.toContain("boom");
  });

  it("does not let a block or a failure of one scenario stop the others", async () => {
    const planned = plan([{ id: "ss-a", scenario: omit() }, { id: "ss-b", scenario: omit() }, { id: "ss-c", scenario: omit() }]);
    const sender = new FakeSender((_request, _options, call) => (call === 1 ? blockedOutcome("host_not_allowed") : call === 2 ? failedOutcome("connect") : ok(401, "{}")));
    const { run, results } = await execute(planned, { sender });
    expect(outcomes(results)).toEqual(["blocked", "errored", "inconclusive"]);
    expect(run.summary).toEqual({ passed: 0, failed: 0, inconclusive: 1, blocked: 1, errored: 1, not_run: 0 });
  });

  it("settles the run with a result for every planned scenario and counts that match them", async () => {
    const planned = plan([{ id: "ss-a", scenario: omit() }, { id: "ss-b", scenario: omit() }]);
    const { run, results } = await execute(planned, { sender: new FakeSender() });
    expect(results.map((result) => result.scenarioId)).toEqual(["ss-a", "ss-b"]);
    expect(Object.values(run.summary).reduce((sum, count) => sum + count, 0)).toBe(planned.length);
    expect(run.completedAt).toBeDefined();
  });
});

describe("the scenario's own state", () => {
  it("marks a judged scenario evaluated, a sent but unjudged one executed, and leaves a blocked or unsent one as not run", async () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const planned = plan([{ id: "ss-sent", scenario: omit }, { id: "ss-blocked", scenario: omit }, { id: "ss-errored", scenario: omit }]);
    const sender = new FakeSender((_request, _options, call) => (call === 2 ? blockedOutcome("host_not_allowed") : call === 3 ? failedOutcome("timeout") : ok(401, "{}")));
    await execute(planned, { sender });
    const status = (id: string) => getSecurityScenarioRepository().getScenario(OWNER_A, id)?.executionStatus;
    expect(status("ss-sent")).toBe("evaluated");
    expect(status("ss-blocked")).toBe("not_run");
    expect(status("ss-errored")).toBe("executed");
  });
});

describe("evidence", () => {
  it("is stored per request, redacted, and linked to its result", async () => {
    const swap = pick(scenarios, "GET /orders/{orderId}", "path-id.substitute");
    const sender = new FakeSender(() => ok(403, JSON.stringify({ error: `bad token ${BOB_TOKEN}`, access_token: ALICE_TOKEN })));
    const { results } = await execute(plan([{ id: "ss-bola", scenario: swap }]), { sender });
    const records = getSecurityEvidenceRepository().list(SESSION, results[0].id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ index: 0, method: "GET", responseStatus: 403, destination: { verdict: "allowed" } });
    expect(records[0].urlRedacted).toBe("http://127.0.0.1:4700/orders/ord-1001");
    assertNoSecrets("evidence", JSON.stringify(records), [ALICE_TOKEN, BOB_TOKEN, ...ALL_SECRETS]);
    assertNoSecrets("results", JSON.stringify(results), [ALICE_TOKEN, BOB_TOKEN, ...ALL_SECRETS]);
  });

  it("records a blocked destination as evidence with the reason, though nothing was sent", async () => {
    const sender = new FakeSender(() => blockedOutcome("restricted_address_blocked"));
    const { results } = await execute(plan([{ id: "ss-a", scenario: pick(scenarios, "GET /orders", "auth.omit") }]), { sender });
    const [record] = getSecurityEvidenceRepository().list(SESSION, results[0].id);
    expect(record.destination).toMatchObject({ verdict: "blocked", reason: "restricted_address_blocked" });
    expect(record.error).toEqual({ category: "blocked" });
  });
});

describe("cancellation (FR-044)", () => {
  it("aborts the request in flight, stops dequeuing, records the rest as not run, and settles as cancelled", async () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const planned = plan([{ id: "ss-a", scenario: omit }, { id: "ss-b", scenario: omit }, { id: "ss-c", scenario: omit }]);
    const controller = new AbortController();
    const sender = new FakeSender(
      (_request, options) =>
        new Promise<SendOutcome>((resolve) => {
          setTimeout(() => controller.abort(), 20);
          options.signal?.addEventListener("abort", () => resolve(failedOutcome("aborted")), { once: true });
        }),
    );
    const { run, results } = await execute(planned, { sender, signal: controller.signal });
    expect(sender.calls).toHaveLength(1);
    expect(sender.signals[0].aborted).toBe(true);
    expect(outcomes(results)).toEqual(["not_run", "not_run", "not_run"]);
    expect(results[0].reason).toMatch(/cancelled/i);
    expect(run.status).toBe("cancelled");
    expect(run.summary.not_run).toBe(3);
  });

  it("keeps what finished before the cancel, and does not start a scenario after it", async () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const planned = plan([{ id: "ss-a", scenario: omit }, { id: "ss-b", scenario: omit }]);
    const controller = new AbortController();
    const sender = new FakeSender((_request, _options, call) => {
      if (call === 1) controller.abort();
      return ok(401, "{}");
    });
    const { run, results } = await execute(planned, { sender, signal: controller.signal });
    expect(sender.calls).toHaveLength(1);
    expect(results.map((result) => result.scenarioId)).toEqual(["ss-a", "ss-b"]);
    expect(results[1].outcome).toBe("not_run");
    expect(run.status).toBe("cancelled");
  });

  it("still attempts cleanup after a cancel, with a signal that is not aborted", async () => {
    const create = pick(scenarios, "POST /orders", "field.violate-constraint");
    const other = pick(scenarios, "GET /orders", "auth.omit");
    const planned = plan([{ id: "ss-create", scenario: create, cleanup: 1 }, { id: "ss-slow", scenario: other }]);
    const controller = new AbortController();
    const profile = fullProfile({ destructivePermitted: true, cleanup: { strategy: "delete-created-via-spec", idField: "id" } });
    const sender = new FakeSender((request, options, call) => {
      if (request.method === "DELETE") {
        expect(options.signal?.aborted ?? false).toBe(false);
        return ok(204, "");
      }
      if (call === 1) {
        queueMicrotask(() => controller.abort());
        return ok(201, '{"id":"o-77"}');
      }
      return ok(401, "{}");
    });
    const { run } = await execute(planned, { sender, profile, signal: controller.signal });
    expect(run.status).toBe("cancelled");
    const deletes = sender.calls.filter((request) => request.method === "DELETE");
    expect(deletes.map((request) => request.url)).toEqual(["http://127.0.0.1:4700/orders/o-77"]);
    expect(run.cleanup).toEqual([expect.objectContaining({ scenarioId: "ss-create", state: "done", action: "DELETE /orders/{orderId}" })]);
  });
});

describe("cleanup (FR-045, FR-046, SC-008)", () => {
  const profile = (idField = "id") => fullProfile({ destructivePermitted: true, cleanup: { strategy: "delete-created-via-spec", idField } });
  const create = () => pick(scenarios, "POST /orders", "field.violate-constraint");

  it("deletes what a scenario created through the documented DELETE, as the same kind of caller", async () => {
    const sender = new FakeSender((request) => (request.method === "DELETE" ? ok(204, "") : ok(201, '{"id":"o-1"}')));
    const { run } = await execute(plan([{ id: "ss-create", scenario: create(), cleanup: 1 }]), { sender, profile: profile() });
    expect(run.cleanup).toEqual([{ scenarioId: "ss-create", action: "DELETE /orders/{orderId}", state: "done", detail: "Deleted (204)." }]);
    const remove = sender.calls.find((request) => request.method === "DELETE");
    expect(remove?.url).toBe("http://127.0.0.1:4700/orders/o-1");
    expect(remove?.headers.authorization).toBe(`Bearer ${ALICE_TOKEN}`);
  });

  it("treats a 404 on the delete as already gone", async () => {
    const sender = new FakeSender((request) => (request.method === "DELETE" ? ok(404, "") : ok(201, '{"id":"o-1"}')));
    const { run } = await execute(plan([{ id: "ss-create", scenario: create(), cleanup: 1 }]), { sender, profile: profile() });
    expect(run.cleanup[0]).toMatchObject({ state: "done", detail: "The resource was already gone (404)." });
  });

  it("reports a failed delete with what was left behind and how to remove it by hand", async () => {
    const sender = new FakeSender((request) => (request.method === "DELETE" ? ok(500, "") : ok(201, '{"id":"o-1"}')));
    const { run } = await execute(plan([{ id: "ss-create", scenario: create(), cleanup: 1 }]), { sender, profile: profile() });
    expect(run.status).toBe("completed");
    expect(run.cleanup[0]).toMatchObject({ scenarioId: "ss-create", state: "failed" });
    expect(run.cleanup[0].detail).toMatch(/500/);
    expect(run.cleanup[0].leftBehind).toBe("A resource created by POST /orders");
    expect(run.cleanup[0].manualRemoval).toMatch(/DELETE \/orders\/<id>/);
    expect(JSON.stringify(run.cleanup)).not.toContain("o-1");
  });

  it("reports a cleanup that could not be sent, or was blocked, as failed", async () => {
    const blocked = new FakeSender((request) => (request.method === "DELETE" ? blockedOutcome("host_not_allowed") : ok(201, '{"id":"o-1"}')));
    const first = await execute(plan([{ id: "ss-create", scenario: create(), cleanup: 1 }]), { sender: blocked, profile: profile() });
    expect(first.run.cleanup[0]).toMatchObject({ state: "failed", detail: expect.stringMatching(/allowed hosts/) });
  });

  it("reports an unreadable id field as failed instead of guessing a resource", async () => {
    const sender = new FakeSender(() => ok(201, '{"other":1}'));
    const { run } = await execute(plan([{ id: "ss-create", scenario: create(), cleanup: 1 }]), { sender, profile: profile("id") });
    expect(run.cleanup[0]).toMatchObject({ state: "failed", detail: expect.stringContaining('"id"') });
    expect(sender.calls.filter((request) => request.method === "DELETE")).toEqual([]);
  });

  it("reports a create with no documented delete as failed, saying ApiPilot does not guess a route", async () => {
    const without: ApiModel = { ...model, operations: model.operations.filter((operation) => operation.method.toUpperCase() !== "DELETE") };
    model = without;
    const sender = new FakeSender(() => ok(201, '{"id":"o-1"}'));
    const { run } = await execute(plan([{ id: "ss-create", scenario: create(), cleanup: 0 }]), { sender, profile: profile() });
    expect(run.cleanup[0]).toMatchObject({ state: "failed", leftBehind: "A resource created by POST /orders" });
    expect(run.cleanup[0].manualRemoval).toMatch(/does not guess/);
    expect(sender.calls.every((request) => request.method !== "DELETE")).toBe(true);
  });

  it("does nothing when the strategy is none", async () => {
    const sender = new FakeSender(() => ok(201, '{"id":"o-1"}'));
    expect((await execute(plan([{ id: "ss-a", scenario: create() }]), { sender })).run.cleanup).toEqual([]);
    expect(sender.calls.every((request) => request.method !== "DELETE")).toBe(true);
  });

  it("does nothing for a scenario that created nothing", async () => {
    const refused = new FakeSender(() => ok(400, "{}"));
    expect((await execute(plan([{ id: "ss-b", scenario: create(), cleanup: 1 }]), { sender: refused, profile: profile() })).run.cleanup).toEqual([]);
    expect(refused.calls.every((request) => request.method !== "DELETE")).toBe(true);
  });

  it("uses the allowance the plan set aside, so a plan at its limit can still clean up", async () => {
    const sender = new FakeSender((request) => (request.method === "DELETE" ? ok(204, "") : ok(201, '{"id":"o-1"}')));
    const planned = plan([{ id: "ss-create", scenario: create(), cleanup: 1 }]);
    const { run } = await execute(planned, { sender, profile: profile(), maxRequests: planned[0].plannedRequests + 1 });
    expect(run.cleanup[0].state).toBe("done");
    expect(run.budget.used).toBe(planned[0].plannedRequests + 1);
  });
});

describe("a failure inside the run", () => {
  it("settles as failed, records every unreached scenario, and never leaves the run in progress", async () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const planned = plan([{ id: "ss-a", scenario: omit }, { id: "ss-b", scenario: omit }]);
    const broken = deps(new FakeSender());
    const failing: RunServiceDeps = { ...broken, scenarios: { ...broken.scenarios, updateHead: () => { throw new Error("database is locked"); } } as never };
    const run = startRow(planned);
    await runSecurityRun(failing, {
      run,
      planned,
      profile: fullProfile(),
      environment: { tier: "local", baseUrl: "http://127.0.0.1:4700" },
      apiModel: model,
      limits: run.limits,
      credential: fixtureCredential,
      signal: new AbortController().signal,
    });
    const settled = getSecurityRunRepository().getRun(OWNER_A, run.id) as SecurityRun;
    expect(settled.status).toBe("failed");
    expect(getSecurityRunRepository().listResults(OWNER_A, run.id).map((result) => result.scenarioId).sort()).toEqual(["ss-a", "ss-b"]);
    expect(settled.completedAt).toBeDefined();
  });
});
