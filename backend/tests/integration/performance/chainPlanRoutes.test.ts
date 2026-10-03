import { describe, expect, it } from "vitest";
import { getEnvironmentRepository } from "../../../src/persistence/environmentRepository";
import { chainAgent, CHAIN_BASE, createEnvironment, inputOf, newPlan, savePlanContent } from "../../fixtures/chain/chainAgent";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T020; contracts/chain-plan-api.md "Plans"). */

describe("request-chain plan routes: plans", () => {
  it("creates an empty plan, lists it, reads it and deletes it", async () => {
    const { agent } = await chainAgent();
    const created = await agent.post(CHAIN_BASE).send({ name: "  Customer lifecycle " });
    expect(created.status).toBe(201);
    expect(created.body.plan).toMatchObject({ name: "Customer lifecycle", revision: 1, chains: [{ id: "c1", name: "Chain 1", steps: [] }], thinkTimeMs: 1000, loadProfile: { kind: "smoke" } });
    expect(created.body.script).toBeNull();
    expect(created.body.analysis.blockers).toEqual([{ kind: "no-runnable-chain" }]);
    const id = created.body.plan.id as string;

    const list = await agent.get(CHAIN_BASE);
    expect(list.body.plans).toEqual([{ id, name: "Customer lifecycle", chainCount: 1, stepCount: 0, dataSetCount: 0, seedSource: null, updatedAt: created.body.plan.updatedAt }]);
    expect((await agent.get(`${CHAIN_BASE}/${id}`)).body.plan).toEqual(created.body.plan);

    expect((await agent.delete(`${CHAIN_BASE}/${id}`)).status).toBe(204);
    const gone = await agent.get(`${CHAIN_BASE}/${id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("chain_plan_not_found");
  });

  it("refuses a missing name and a plan of another session", async () => {
    const { agent } = await chainAgent();
    expect((await agent.post(CHAIN_BASE).send({ name: " " })).body.error).toBe("invalid_plan");
    const plan = await newPlan(agent);
    const other = await chainAgent();
    expect((await other.agent.get(`${CHAIN_BASE}/${plan.id}`)).status).toBe(404);
    expect((await other.agent.put(`${CHAIN_BASE}/${plan.id}`).send({ revision: 1, plan: inputOf(plan) })).status).toBe(404);
    expect((await agent.get(`${CHAIN_BASE}/not-a-uuid`)).status).toBe(404);
  });

  it("saves the whole plan at its revision, and returns the analysis", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const saved = await savePlanContent(agent, plan, customerLifecyclePlan());
    expect(saved.status).toBe(200);
    expect(saved.body.plan.revision).toBe(2);
    expect(saved.body.plan.chains[0].steps).toHaveLength(7);
    expect(saved.body.plan.chains[0].steps.every((step: { source: { kind: string } }) => step.source.kind === "added")).toBe(true);
    expect(saved.body.analysis.blockers).toEqual([]);
    expect(saved.body.analysis.requiredValues.map((value: { name: string }) => value.name)).toEqual(["baseUrl", "client_id", "client_secret"]);
    expect(saved.body.analysis.hosts).toEqual(["{{baseUrl}}"]);
    expect(saved.body.movedCredentials).toEqual([]);
  });

  it("refuses a stale revision with the current plan, and saves nothing", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    await savePlanContent(agent, plan, customerLifecyclePlan());
    const stale = await agent.put(`${CHAIN_BASE}/${plan.id}`).send({ revision: 1, plan: { ...inputOf(plan), name: "Lost" } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("plan_revision_conflict");
    expect(stale.body.current.plan.revision).toBe(2);
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan.name).toBe("Customer lifecycle");
  });

  it.each([
    [{ chains: [] }, 422, "invalid_plan"],
    [{ chains: [{ id: "c1", name: "", steps: [] }] }, 422, "invalid_chain"],
  ])("refuses %j", async (patch, status, code) => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const response = await agent.put(`${CHAIN_BASE}/${plan.id}`).send({ revision: 1, plan: { ...inputOf(plan), ...patch } });
    expect(response.status).toBe(status);
    expect(response.body.error).toBe(code);
  });

  it("refuses invalid steps and headers the runtime sets, naming the step and field", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const content = customerLifecyclePlan();
    content.chains[0].steps[1] = { ...content.chains[0].steps[1], url: "{{baseUrl}}/a?x=1" };
    const invalid = await savePlanContent(agent, plan, content);
    expect(invalid.status).toBe(422);
    expect(invalid.body).toMatchObject({ error: "invalid_step", stepId: "s2", field: "url" });
    const host = customerLifecyclePlan();
    host.chains[0].steps[2] = { ...host.chains[0].steps[2], headers: [{ name: "Host", value: "example.test" }] };
    const notSettable = await savePlanContent(agent, plan, host);
    expect(notSettable.body).toMatchObject({ error: "header_not_settable", stepId: "s3", header: "Host" });
  });

  it("refuses a literal credential without a target environment, and moves it into one when chosen", async () => {
    const { agent, sessionId } = await chainAgent();
    const plan = await newPlan(agent);
    const content = customerLifecyclePlan();
    content.chains[0].steps[1] = { ...content.chains[0].steps[1], headers: [{ name: "Authorization", value: "Bearer literal-MARKER-9f1" }] };

    const refused = await savePlanContent(agent, plan, content);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: "credential_needs_environment", stepId: "s2", location: { kind: "header", name: "Authorization" } });
    expect(JSON.stringify(refused.body)).not.toContain("literal-MARKER-9f1");

    const environmentId = await createEnvironment(agent, { client_id: "id-1" });
    const saved = await savePlanContent(agent, plan, { ...content, targetEnvironmentId: environmentId });
    expect(saved.status).toBe(200);
    expect(saved.body.movedCredentials).toEqual([{ stepId: "s2", location: { kind: "header", name: "Authorization" }, valueName: "authorization_s2", environmentName: "Local stub" }]);
    expect(saved.body.plan.chains[0].steps[1].headers).toEqual([{ name: "Authorization", value: "Bearer {{authorization_s2}}" }]);
    expect(saved.body.plan.secretNames).toEqual(["authorization_s2", "client_secret"]);
    expect(JSON.stringify(saved.body)).not.toContain("literal-MARKER-9f1");
    expect(JSON.stringify((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body)).not.toContain("literal-MARKER-9f1");
    expect(getEnvironmentRepository().get(sessionId, environmentId)?.variableValues.authorization_s2).toBe("literal-MARKER-9f1");
  });

  it("refuses a target environment that does not exist", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const response = await savePlanContent(agent, plan, customerLifecyclePlan({ targetEnvironmentId: "00000000-0000-4000-8000-0000000000ff" }));
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("environment_not_found");
  });

  it("duplicates a plan with a new id and name", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    await savePlanContent(agent, plan, customerLifecyclePlan());
    const copy = await agent.post(`${CHAIN_BASE}/${plan.id}/duplicate`).send({ name: "Copy" });
    expect(copy.status).toBe(201);
    expect(copy.body.plan.id).not.toBe(plan.id);
    expect(copy.body.plan).toMatchObject({ name: "Copy", revision: 1 });
    expect(copy.body.plan.chains).toEqual((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan.chains);
    expect((await agent.get(CHAIN_BASE)).body.plans).toHaveLength(2);
  });

  it("accepts a plan document up to 8 MiB and refuses a larger body", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const big = await agent
      .put(`${CHAIN_BASE}/${plan.id}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ revision: 1, plan: inputOf(plan), padding: "x".repeat(8 * 1024 * 1024 - 2000) }));
    expect(big.status).toBe(200);
    const tooBig = await agent
      .put(`${CHAIN_BASE}/${plan.id}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ revision: 2, plan: inputOf(plan), padding: "x".repeat(8 * 1024 * 1024) }));
    expect(tooBig.status).toBe(413);
  });
});
