import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChainPlan } from "@apipilot/shared-domain";
import { seededOperationKeys } from "@apipilot/shared-domain";
import { resetQuickTestsForTest } from "../../../src/performance/quick/quickTestStore";
import { chainAgent, CHAIN_BASE, inputOf, newPlan } from "../../fixtures/chain/chainAgent";
import { openApiFixtureBuffer } from "../../fixtures/performance/specification";

/**
 * AP-047 (specs/047-unified-performance-tab contracts/reselect-api.md; US3, FR-015 to FR-017):
 * `POST /api/chain-plans/:planId/reselect`.
 */

const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "chain");
const WEAK = readFileSync(path.join(FIXTURES, "weak-spec.yaml"));
const CREATE = "POST /api/v1/customers";
const REPLACE = "PUT /customer/{customerId}";
const LIST = "GET /api/v1/customers";
const DELETE = "DELETE /customer/{customerId}";

type Context = Awaited<ReturnType<typeof chainAgent>>;
type Agent = Context["agent"];
type Step = ChainPlan["chains"][number]["steps"][number];

async function withSpecification(buffer: Buffer = WEAK, filename = "weak-spec.yaml") {
  const context = await chainAgent();
  expect((await context.agent.post("/api/quick-performance").attach("file", buffer, filename)).status).toBe(200);
  return context;
}

async function seed(agent: Agent, keys?: string[]): Promise<ChainPlan> {
  const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "Weak", source: { kind: "specification", ...(keys ? { selectedOperationKeys: keys } : {}) } });
  expect(seeded.status).toBe(201);
  return seeded.body.plan as ChainPlan;
}

const reselect = (agent: Agent, plan: ChainPlan, body: Record<string, unknown>) => agent.post(`${CHAIN_BASE}/${plan.id}/reselect`).send({ revision: plan.revision, mode: "merge", ...body });
const stored = async (agent: Agent, plan: ChainPlan) => (await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan as ChainPlan;
const isKey = (step: Step, key: string) => step.source.kind === "operation" && step.source.operationKey === key;
const chainOf = (plan: ChainPlan, key: string) => plan.chains.find((chain) => chain.steps.some((step) => isKey(step, key)));
const stepOf = (plan: ChainPlan, key: string) => plan.chains.flatMap((chain) => chain.steps).find((step) => isKey(step, key))!;

/** Saves the plan with `edit` applied to the step of `key`, as the editor does. */
async function editStep(agent: Agent, plan: ChainPlan, key: string, edit: (step: Step) => Step): Promise<ChainPlan> {
  const next: ChainPlan = { ...plan, chains: plan.chains.map((chain) => ({ ...chain, steps: chain.steps.map((step) => (isKey(step, key) ? edit(step) : step)) })) };
  const saved = await agent.put(`${CHAIN_BASE}/${plan.id}`).send({ revision: plan.revision, plan: inputOf(next) });
  expect(saved.status).toBe(200);
  return saved.body.plan as ChainPlan;
}

describe("POST /api/chain-plans/:planId/reselect: merge", () => {
  it("appends newly selected operations after the existing chains, in specification order, and changes nothing else", async () => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE, REPLACE]);
    const response = await reselect(agent, plan, { selectedOperationKeys: [CREATE, REPLACE, LIST, DELETE] });
    expect(response.status).toBe(200);
    expect([...response.body.added].sort()).toEqual([LIST, DELETE].sort());
    expect(response.body.removed).toEqual([]);
    const after = response.body.plan as ChainPlan;
    expect(after.revision).toBe(plan.revision + 1);
    // The chains that stay are byte for byte what they were; the new ones come last.
    expect(after.chains.slice(0, plan.chains.length)).toEqual(plan.chains);
    expect(seededOperationKeys(after)).toEqual(expect.arrayContaining([CREATE, REPLACE, LIST, DELETE]));
    expect(after.chains.slice(plan.chains.length).map((chain) => chain.name)).toEqual([LIST, DELETE]);
    // Ids are taken from the counters and never reused.
    const stepIds = after.chains.flatMap((chain) => chain.steps.map((step) => step.id));
    expect(new Set(stepIds).size).toBe(stepIds.length);
    expect(after.nextStepNumber).toBeGreaterThan(plan.nextStepNumber);
    expect(after.nextChainNumber).toBeGreaterThan(plan.nextChainNumber);
    expect(response.body).toHaveProperty("analysis");
    expect(await stored(agent, plan)).toEqual(after);
  });

  it("keeps the step the engineer edited, with its edit and its id, while adding another operation", async () => {
    const { agent } = await withSpecification();
    const seeded = await seed(agent, [CREATE, REPLACE]);
    const edited = await editStep(agent, seeded, REPLACE, (step) => ({ ...step, expectedStatuses: ["200", "204"], headers: [{ name: "X-Tenant", value: "{{tenant_id}}" }] }));
    const before = stepOf(edited, REPLACE);
    expect(before.changed).toBe(true);
    const response = await reselect(agent, edited, { selectedOperationKeys: [CREATE, REPLACE, LIST] });
    expect(response.status).toBe(200);
    expect(response.body.keptEdited).toEqual([REPLACE]);
    expect(stepOf(response.body.plan as ChainPlan, REPLACE)).toEqual(before);
  });

  it("removes a deselected step that was never edited, with its chain, without asking", async () => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE, REPLACE, LIST]);
    const response = await reselect(agent, plan, { selectedOperationKeys: [CREATE, REPLACE] });
    expect(response.status).toBe(200);
    expect(response.body.removed).toEqual([LIST]);
    expect(chainOf(response.body.plan as ChainPlan, LIST)).toBeUndefined();
    expect([...seededOperationKeys(response.body.plan as ChainPlan)].sort()).toEqual([CREATE, REPLACE].sort());
  });

  it("refuses to remove an edited step until confirmed, and changes nothing meanwhile", async () => {
    const { agent } = await withSpecification();
    const seeded = await seed(agent, [CREATE, REPLACE]);
    const edited = await editStep(agent, seeded, REPLACE, (step) => ({ ...step, expectedStatuses: ["200", "204"] }));
    const refused = await reselect(agent, edited, { selectedOperationKeys: [CREATE] });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("edited_steps_would_be_removed");
    expect(refused.body.edited).toEqual([expect.objectContaining({ operationKey: REPLACE, reasons: ["step-changed"] })]);
    expect(await stored(agent, edited)).toEqual(edited);

    const confirmed = await reselect(agent, edited, { selectedOperationKeys: [CREATE], confirmRemoveEdited: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.removed).toEqual([REPLACE]);
    expect(chainOf(confirmed.body.plan as ChainPlan, REPLACE)).toBeUndefined();
  });

  it("keeps a chain the engineer made, and drops a threshold scoped to a step it removed", async () => {
    const { agent } = await withSpecification();
    const seeded = await seed(agent, [CREATE, REPLACE, LIST]);
    const listStep = stepOf(seeded, LIST);
    const withMine: ChainPlan = {
      ...seeded,
      chains: [...seeded.chains, { id: `c${seeded.nextChainNumber}`, name: "Mine", steps: [] }],
      nextChainNumber: seeded.nextChainNumber + 1,
      thresholds: [
        { id: "t-run", scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 900 },
        { id: "t-step", scope: { kind: "step", stepId: listStep.id }, metric: "p95", comparator: "<=", limit: 500 },
      ],
    };
    const saved = await agent.put(`${CHAIN_BASE}/${seeded.id}`).send({ revision: seeded.revision, plan: inputOf(withMine) });
    expect(saved.status).toBe(200);
    const response = await reselect(agent, saved.body.plan as ChainPlan, { selectedOperationKeys: [CREATE, REPLACE] });
    expect(response.status).toBe(200);
    const after = response.body.plan as ChainPlan;
    expect(after.chains.map((chain) => chain.name)).toContain("Mine");
    expect(after.thresholds).toHaveLength(1);
    expect(after.thresholds[0].scope).toEqual({ kind: "run" });
  });

  it("never touches the name, load profile, environment or data sets", async () => {
    const { agent } = await withSpecification();
    const seeded = await seed(agent, [CREATE]);
    const csv = readFileSync(path.join(FIXTURES, "customers.csv"));
    const uploaded = await agent.post(`${CHAIN_BASE}/${seeded.id}/data-sets`).field("name", "customers").field("mode", "row-per-iteration").attach("file", csv, "customers.csv");
    expect(uploaded.status).toBe(201);
    const withData = await stored(agent, seeded);
    const response = await reselect(agent, withData, { selectedOperationKeys: [CREATE, REPLACE] });
    expect(response.status).toBe(200);
    const after = response.body.plan as ChainPlan;
    expect(after).toMatchObject({ name: withData.name, loadProfile: withData.loadProfile, targetEnvironmentId: withData.targetEnvironmentId, thinkTimeMs: withData.thinkTimeMs });
    expect(after.dataSets).toEqual(withData.dataSets);
    expect(after.dataSets).toHaveLength(1);
  });

  it("leaves the script out of date, because the chains changed", async () => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE]);
    const response = await reselect(agent, plan, { selectedOperationKeys: [CREATE, REPLACE] });
    expect(response.status).toBe(200);
    expect(response.body.script === null || response.body.script.outOfDate === true).toBe(true);
  });
});

describe("POST /api/chain-plans/:planId/reselect: reset", () => {
  it("rebuilds the chains from the selection, discards edits and engineer chains, and keeps everything else", async () => {
    const { agent } = await withSpecification();
    const seeded = await seed(agent, [CREATE, REPLACE]);
    const edited = await editStep(agent, seeded, REPLACE, (step) => ({ ...step, expectedStatuses: ["204"] }));
    const withMine: ChainPlan = { ...edited, chains: [...edited.chains, { id: `c${edited.nextChainNumber}`, name: "Mine", steps: [] }], nextChainNumber: edited.nextChainNumber + 1, thinkTimeMs: 2500 };
    const saved = (await agent.put(`${CHAIN_BASE}/${edited.id}`).send({ revision: edited.revision, plan: inputOf(withMine) })).body.plan as ChainPlan;

    const response = await reselect(agent, saved, { mode: "reset", selectedOperationKeys: [CREATE, REPLACE, LIST] });
    expect(response.status).toBe(200);
    const after = response.body.plan as ChainPlan;
    expect(after.chains.map((chain) => chain.name)).not.toContain("Mine");
    expect(after.chains.flatMap((chain) => chain.steps).every((step) => step.source.kind === "operation" && !step.changed)).toBe(true);
    expect(stepOf(after, REPLACE).expectedStatuses).not.toEqual(["204"]);
    expect([...seededOperationKeys(after)].sort()).toEqual([CREATE, REPLACE, LIST].sort());
    expect(after.thinkTimeMs).toBe(2500);
    expect(after.name).toBe(saved.name);
    // New ids continue the plan's counters, so no id from before is reused.
    const oldIds = new Set(saved.chains.flatMap((chain) => [chain.id, ...chain.steps.map((step) => step.id)]));
    for (const chain of after.chains) {
      expect(oldIds.has(chain.id)).toBe(false);
      for (const step of chain.steps) expect(oldIds.has(step.id)).toBe(false);
    }
  });
});

describe("POST /api/chain-plans/:planId/reselect: refusals", () => {
  it("answers a stale revision with the current plan, and changes nothing", async () => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE]);
    const response = await agent.post(`${CHAIN_BASE}/${plan.id}/reselect`).send({ revision: plan.revision + 5, mode: "merge", selectedOperationKeys: [CREATE, REPLACE] });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("plan_revision_conflict");
    expect(response.body.current.plan.id).toBe(plan.id);
    expect(await stored(agent, plan)).toEqual(plan);
  });

  it("is for plans seeded from a specification only", async () => {
    const { agent } = await withSpecification();
    const empty = await newPlan(agent);
    const response = await reselect(agent, empty, { selectedOperationKeys: [CREATE] });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("plan_source_not_supported");
  });

  it("refuses when the uploaded specification is no longer the one the plan was seeded from", async () => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE]);
    const replaced = await agent.post("/api/quick-performance?replaceExisting=true").attach("file", openApiFixtureBuffer("quick-performance.yaml"), "quick-performance.yaml");
    expect(replaced.status).toBe(200);
    const response = await reselect(agent, plan, { selectedOperationKeys: [CREATE] });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: "plan_source_changed", planSource: "weak-spec.yaml", currentSource: "quick-performance.yaml" });
    expect(await stored(agent, plan)).toEqual(plan);
  });

  it("asks for an upload when the session holds no specification", async () => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE]);
    resetQuickTestsForTest();
    const response = await reselect(agent, plan, { selectedOperationKeys: [CREATE, REPLACE] });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("quick_test_not_found");
  });

  it.each([
    ["an unknown operation", { selectedOperationKeys: ["GET /nope"] }, "selectedOperationKeys"],
    ["an empty selection", { selectedOperationKeys: [] }, "selectedOperationKeys"],
    ["a selection that is not a list of text", { selectedOperationKeys: [1] }, "selectedOperationKeys"],
    ["a mode that is neither merge nor reset", { mode: "replace", selectedOperationKeys: [CREATE] }, "mode"],
    ["a confirmation that is not true or false", { selectedOperationKeys: [CREATE], confirmRemoveEdited: "yes" }, "confirmRemoveEdited"],
  ])("refuses %s as an invalid plan on the field, and changes nothing", async (_name, body, field) => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE]);
    const response = await reselect(agent, plan, body);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: "invalid_plan", field });
    expect(await stored(agent, plan)).toEqual(plan);
  });

  it("refuses a missing revision", async () => {
    const { agent } = await withSpecification();
    const plan = await seed(agent, [CREATE]);
    const response = await agent.post(`${CHAIN_BASE}/${plan.id}/reselect`).send({ mode: "merge", selectedOperationKeys: [CREATE] });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: "invalid_plan", field: "revision" });
  });

  it("answers an unknown plan with 404", async () => {
    const { agent } = await withSpecification();
    const response = await agent.post(`${CHAIN_BASE}/22222222-2222-4222-8222-222222222222/reselect`).send({ revision: 1, mode: "merge", selectedOperationKeys: [CREATE] });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("chain_plan_not_found");
  });
});

describe("POST /api/chain-plans/:planId/reselect: determinism", () => {
  it("gives the same chains for the same plan and selection in two sessions", async () => {
    const run = async () => {
      const { agent } = await withSpecification();
      const plan = await seed(agent, [CREATE, REPLACE]);
      const response = await reselect(agent, plan, { selectedOperationKeys: [CREATE, LIST, DELETE] });
      expect(response.status).toBe(200);
      return (response.body.plan as ChainPlan).chains;
    };
    expect(await run()).toEqual(await run());
  });
});

describe("POST /api/chain-plans/:planId/reselect: the Credentials chain", () => {
  const LOGIN = "POST /auth/login";
  const SCHEME = "securityScheme:OrdersAuth";

  async function quickPlan(keys: string[]) {
    const context = await withSpecification(openApiFixtureBuffer("quick-performance.yaml"), "quick-performance.yaml");
    return { ...context, plan: await seed(context.agent, keys) };
  }

  it("adds a login operation to a new Credentials chain, first, when it is selected, as an ordinary operation", async () => {
    const { agent, plan } = await quickPlan(["GET /orders"]);
    expect(plan.chains.map((chain) => chain.name)).not.toContain("Credentials");
    const response = await reselect(agent, plan, { selectedOperationKeys: ["GET /orders", LOGIN] });
    expect(response.status).toBe(200);
    expect(response.body.added).toEqual([LOGIN]);
    const after = response.body.plan as ChainPlan;
    expect(after.chains[0].name).toBe("Credentials");
    expect(after.chains[0].steps[0]).toMatchObject({ runs: "once-before-load", source: { operationKey: LOGIN } });
    // The chain that was already there is untouched, and follows the new first chain.
    expect(after.chains.slice(1)).toEqual(plan.chains);
  });

  it("removes the Credentials chain with its login step when it is deselected and was not edited", async () => {
    const { agent, plan } = await quickPlan(["GET /orders", LOGIN]);
    expect(plan.chains[0].name).toBe("Credentials");
    const response = await reselect(agent, plan, { selectedOperationKeys: ["GET /orders"] });
    expect(response.status).toBe(200);
    expect(response.body.removed).toEqual([LOGIN]);
    expect((response.body.plan as ChainPlan).chains.map((chain) => chain.name)).toEqual(["GET /orders"]);
  });

  it("asks before dropping a login step the engineer edited, and drops it once confirmed", async () => {
    const { agent, plan } = await quickPlan(["GET /orders", LOGIN]);
    const edited = await editStep(agent, plan, LOGIN, (step) => ({ ...step, expectedStatuses: ["200", "201"] }));
    const refused = await reselect(agent, edited, { selectedOperationKeys: ["GET /orders"] });
    expect(refused.status).toBe(409);
    expect(refused.body.edited).toEqual([expect.objectContaining({ operationKey: LOGIN, reasons: ["step-changed"] })]);
    expect(await stored(agent, edited)).toEqual(edited);
    const confirmed = await reselect(agent, edited, { selectedOperationKeys: ["GET /orders"], confirmRemoveEdited: true });
    expect(confirmed.status).toBe(200);
    expect((confirmed.body.plan as ChainPlan).chains.map((chain) => chain.name)).toEqual(["GET /orders"]);
  });

  it("keeps one token step for a security scheme when more steps that send its token are added", async () => {
    const context = await withSpecification(openApiFixtureBuffer("performance.yaml"), "performance.yaml");
    const plan = await seed(context.agent, ["GET /status"]);
    expect(plan.chains[0].steps.map((step) => (step.source.kind === "operation" ? step.source.operationKey : null))).toEqual([SCHEME]);
    const response = await reselect(context.agent, plan, { selectedOperationKeys: ["GET /status", "POST /orders"] });
    expect(response.status).toBe(200);
    const after = response.body.plan as ChainPlan;
    // The scheme is never listed as an operation, and its step is the one it already had.
    expect(response.body.added).toEqual(["POST /orders"]);
    expect(after.chains[0]).toEqual(plan.chains[0]);
    expect(after.chains.filter((chain) => chain.name === "Credentials")).toHaveLength(1);
  });
});
