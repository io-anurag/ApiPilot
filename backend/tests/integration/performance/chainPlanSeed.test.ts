import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChainPlan } from "@apipilot/shared-domain";
import { chainAgent, CHAIN_BASE, createEnvironment, inputOf } from "../../fixtures/chain/chainAgent";
import { openApiFixtureBuffer } from "../../fixtures/performance/specification";

/** AP-037 (specs/037-request-chain-performance tasks T051; US2, FR-020, FR-021, FR-026, FR-027). */

const WEAK = readFileSync(path.join(__dirname, "..", "..", "fixtures", "chain", "weak-spec.yaml"));

async function withSpecification(buffer: Buffer, filename = "weak-spec.yaml") {
  const context = await chainAgent();
  const uploaded = await context.agent.post("/api/quick-performance").attach("file", buffer, filename);
  expect(uploaded.status).toBe(200);
  return context;
}

function steps(plan: ChainPlan) {
  return plan.chains.flatMap((chain) => chain.steps);
}

describe("POST /api/chain-plans/seed from a specification", () => {
  it("needs a quick test, and refuses sources not available yet", async () => {
    const { agent } = await chainAgent();
    const missing = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "x", source: { kind: "specification" } });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("quick_test_not_found");
    expect((await agent.post(`${CHAIN_BASE}/seed`).send({ name: "x", source: { kind: "nothing" } })).body.error).toBe("invalid_plan");
  });

  it("seeds a first draft, then keeps every edit exactly as entered with no check against the specification (FR-026)", async () => {
    const { agent } = await withSpecification(WEAK);
    const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "Weak", source: { kind: "specification" } });
    expect(seeded.status).toBe(201);
    const plan = seeded.body.plan as ChainPlan;
    expect(plan.seedingReport?.source).toEqual({ kind: "specification", filename: "weak-spec.yaml" });
    expect(steps(plan).every((step) => step.source.kind === "operation" && !step.changed)).toBe(true);

    const create = plan.chains.find((chain) => chain.name === "POST /api/v1/customers")!;
    const put = plan.chains.find((chain) => chain.name === "PUT /customer/{customerId}")!;
    const edited: ChainPlan = {
      ...plan,
      chains: [
        {
          id: create.id,
          name: "Lifecycle",
          steps: [
            { ...steps(plan)[0], id: `s${plan.nextStepNumber}`, name: "Get a token", method: "POST", url: "{{baseUrl}}/auth/token", query: [], headers: [], body: { kind: "form", fields: [{ name: "client_id", value: "{{client_id}}" }] }, expectedStatuses: ["200"], extractors: [{ id: `x${plan.nextItemNumber}`, name: "token", source: { kind: "body", path: "access_token" } }], runs: "once-before-load", source: { kind: "added" } },
            { ...create.steps[0], body: { kind: "raw", contentType: "application/json", text: '{"name":"Ada Lovelace","email":"ada@example.test"}' }, expectedStatuses: ["201"], headers: [{ name: "Authorization", value: "Bearer {{token}}" }] },
            { ...put.steps[0], url: "{{baseUrl}}/api/v1/customers/{{customer_id}}", headers: [{ name: "X-Tenant-Id", value: "{{tenant_id}}" }, { name: "Authorization", value: "Bearer {{token}}" }] },
          ],
        },
      ],
      nextStepNumber: plan.nextStepNumber + 1,
      nextItemNumber: plan.nextItemNumber + 1,
    };
    const saved = await agent.put(`${CHAIN_BASE}/${plan.id}`).send({ revision: plan.revision, plan: inputOf(edited) });
    expect(saved.status).toBe(200);
    const stored = (await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan as ChainPlan;
    const [token, created, replaced] = stored.chains[0].steps;
    expect(token.source).toEqual({ kind: "added" });
    expect(created).toMatchObject({ expectedStatuses: ["201"], changed: true, source: { kind: "operation", operationKey: "POST /api/v1/customers" } });
    expect(created.body).toEqual({ kind: "raw", contentType: "application/json", text: '{"name":"Ada Lovelace","email":"ada@example.test"}' });
    expect(replaced).toMatchObject({ url: "{{baseUrl}}/api/v1/customers/{{customer_id}}", changed: true, source: { operationKey: "PUT /customer/{customerId}" } });
    expect(replaced.headers).toContainEqual({ name: "X-Tenant-Id", value: "{{tenant_id}}" });
    expect(saved.body.analysis.requiredValues.map((value: { name: string }) => value.name)).toContain("tenant_id");
  });

  it("never changes a seeded plan when a new specification is uploaded and seeded", async () => {
    const { agent } = await withSpecification(WEAK);
    const first = (await agent.post(`${CHAIN_BASE}/seed`).send({ name: "First", source: { kind: "specification" } })).body.plan as ChainPlan;
    await agent.post("/api/quick-performance?replaceExisting=true").attach("file", openApiFixtureBuffer("quick-performance.yaml"), "quick-performance.yaml");
    const second = (await agent.post(`${CHAIN_BASE}/seed`).send({ name: "Second", source: { kind: "specification" } })).body.plan as ChainPlan;
    expect(second.id).not.toBe(first.id);
    expect((await agent.get(`${CHAIN_BASE}/${first.id}`)).body.plan).toEqual(first);
  });

  it("names a target environment for the seeded plan", async () => {
    const { agent } = await withSpecification(WEAK);
    const environmentId = await createEnvironment(agent, { password: "pw" });
    const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "Weak", source: { kind: "specification" }, environmentId });
    expect(seeded.status).toBe(201);
    expect(seeded.body.plan.targetEnvironmentId).toBe(environmentId);
    expect(seeded.body.movedCredentials).toEqual([]);
  });
});
