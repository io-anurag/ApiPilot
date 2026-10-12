import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ChainPlan } from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import { chainAgent, CHAIN_BASE } from "../../fixtures/chain/chainAgent";
import { TWO_FOLDER_REQUEST_IDS, twoFolderCollection } from "../../fixtures/chain/collections";
import { performanceAgent, unavailableProbe } from "../../fixtures/performance/agent";
import { uploadCollection } from "../../fixtures/performance/collectionPlans";
import { establishSession } from "../../fixtures/performance/session";

/** AP-037 (specs/037-request-chain-performance tasks T068; US4, FR-020, FR-023, FR-024, FR-026). */

describe("POST /api/chain-plans/seed from the guided workflow", () => {
  it("is refused until Postman generation is complete", async () => {
    const { agent } = await chainAgent();
    const refused = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "x", source: { kind: "workflow" } });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("workflow_not_ready");
  });

  it("seeds one chain per approved workflow once the workflow is ready", async () => {
    const { agent } = await performanceAgent({});
    const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "Guided", source: { kind: "workflow" } });
    expect(seeded.status).toBe(201);
    const plan = seeded.body.plan as ChainPlan;
    expect(plan.chains.some((chain) => chain.name.startsWith("Workflow "))).toBe(true);
    expect(plan.seedingReport?.source.kind).toBe("workflow");
  });
});

describe("POST /api/chain-plans/seed from a stored collection", () => {
  async function withCollection() {
    const agent = request.agent(createApp(undefined, { performance: { probe: unavailableProbe() } }));
    await establishSession(agent);
    const collectionId = await uploadCollection(agent, twoFolderCollection(), undefined, { name: "Two folders" });
    return { agent, collectionId };
  }

  it("refuses an unknown collection and an empty selection", async () => {
    const { agent, collectionId } = await withCollection();
    const unknown = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "x", source: { kind: "collection", collectionId: "00000000-0000-4000-8000-0000000000ff", orderedRequestIds: ["a"] } });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("uploaded_collection_not_found");
    const empty = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "x", source: { kind: "collection", collectionId, orderedRequestIds: [] } });
    expect(empty.body.error).toBe("no_requests_selected");
  });

  it("seeds chains per folder, and an edit to the collection afterwards leaves the plan unchanged", async () => {
    const { agent, collectionId } = await withCollection();
    const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "From collection", source: { kind: "collection", collectionId, orderedRequestIds: TWO_FOLDER_REQUEST_IDS } });
    expect(seeded.status).toBe(201);
    const plan = seeded.body.plan as ChainPlan;
    expect(plan.chains.map((chain) => chain.name)).toEqual(["Auth", "Customers"]);
    expect(plan.seedingReport?.items.some((item) => item.kind === "pre-request-script")).toBe(true);

    const renamed = await agent.put(`/api/external-collections/${collectionId}/items/req-get/rename`).send({ name: "Renamed in the collection" });
    expect(renamed.status).toBe(200);
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan).toEqual(plan);
  });

  it("carries the collection's configured environment into an editable plan", async () => {
    const { agent } = await withCollection();
    const collectionId = await uploadCollection(
      agent,
      twoFolderCollection(),
      {
        values: [
          { key: "baseUrl", value: "http://127.0.0.1:4600", enabled: true },
          { key: "client_id", value: "configured-client", enabled: true },
        ],
      },
      { name: "Configured collection" },
    );
    const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({
      name: "Configured plan",
      source: { kind: "collection", collectionId, orderedRequestIds: TWO_FOLDER_REQUEST_IDS },
    });
    expect(seeded.status).toBe(201);
    expect(seeded.body.plan.targetEnvironmentId).not.toBeNull();
    expect(seeded.body.analysis.requiredValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "client_id", provided: true }),
      ]),
    );
    expect(JSON.stringify(seeded.body)).not.toContain("configured-client");
  });

  it("copies current values, request edits, inherited auth, base URL aliases and delay without coupling the source", async () => {
    const { agent } = await withCollection();
    const uploaded = await agent.post("/api/external-collections")
      .field("name", "Saved setup")
      .field("tier", "local")
      .field("requestDelayMs", "75")
      .attach(
        "collection",
        Buffer.from(JSON.stringify(twoFolderCollection())),
        "collection.json",
      )
      .attach(
        "environment",
        Buffer.from(
          JSON.stringify({
            values: [
              { key: "serviceUrl", value: "http://127.0.0.1:4700/api", enabled: true },
              { key: "tenant", value: "old-tenant", enabled: true },
            ],
          }),
        ),
        "environment.json",
      );
    expect(uploaded.status).toBe(201);
    const collectionId = uploaded.body.uploadedCollection.id as string;
    expect(
      (
        await agent.put(`/api/external-collections/${collectionId}/items/req-get/rename`).send({
          variableValues: {
            serviceUrl: "http://127.0.0.1:4700/api",
            tenant: "saved-tenant",
            token: "saved-token",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await agent.put(`/api/external-collections/${collectionId}/items/req-get/rename`).send({
            method: "POST",
            url: "{{serviceUrl}}/customers?tenant={{tenant}}",
            headers: [{ key: "Content-Type", value: "application/json" }],
            body: '{"name":"Saved customer"}',
          })
      ).status,
    ).toBe(200);
    const input = {
      name: "Saved setup",
      source: { kind: "collection", collectionId, orderedRequestIds: ["req-create"] },
    };
    const seeded = await agent.post(`${CHAIN_BASE}/seed`).send(input);
    expect(seeded.status).toBe(201);
    const plan = seeded.body.plan as ChainPlan;
    expect(plan.thinkTimeMs).toBe(75);
    expect(plan.chains[0].steps[0]).toMatchObject({
      url: "{{baseUrl}}/customers",
      query: [{ name: "tenant", value: "{{tenant}}" }],
      headers: [{ name: "Authorization", value: "Bearer {{token}}" }],
      body: { kind: "raw", text: '{"name":"Saved customer"}' },
      changed: false,
    });
    const environments = await agent.get("/api/test-generation-workflow/environments");
    expect(environments.status).toBe(200);
    const environment = environments.body.environments.find(
      (item: { id: string }) => item.id === plan.targetEnvironmentId,
    );
    expect(environment).toMatchObject({
      baseUrl: "http://127.0.0.1:4700/api",
      tier: "local",
      requestDelayMs: 75,
      variableValues: { tenant: "saved-tenant", token: "saved-token" },
    });
    expect(JSON.stringify(seeded.body)).not.toContain("saved-token");
    expect(JSON.stringify(seeded.body)).not.toContain("saved-tenant");

    expect(
      (
        await agent.put(`/api/external-collections/${collectionId}/items/req-get/rename`).send({
          variableValues: {
            serviceUrl: "http://127.0.0.1:4800",
            tenant: "new-tenant",
            token: "new-token",
          },
        })
      ).status,
    ).toBe(200);
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan).toEqual(plan);
    const updatedEnvironments = await agent.get(
      "/api/test-generation-workflow/environments",
    );
    expect(
      updatedEnvironments.body.environments.find(
        (item: { id: string }) => item.id === environment.id,
      ),
    ).toEqual(environment);
    const repeated = await agent.post(`${CHAIN_BASE}/seed`).send(input);
    expect(repeated.status).toBe(201);
    expect(repeated.body.plan.targetEnvironmentId).not.toBe(environment.id);

    const edited = await agent.put(`${CHAIN_BASE}/${plan.id}`)
      .send({ revision: plan.revision, plan: { ...plan, thinkTimeMs: 150 } });
    expect(edited.status).toBe(200);
    expect(edited.body.plan.thinkTimeMs).toBe(150);
    const other = request.agent(createApp(undefined, { performance: { probe: unavailableProbe() } }));
    await establishSession(other);
    expect((await other.get(`${CHAIN_BASE}/${plan.id}`)).status).toBe(404);
    expect(
      (await other.get("/api/test-generation-workflow/environments")).body.environments ??
        [],
    ).toEqual([]);
  });

  it("preserves literal credentials in the copied environment, not in the plan", async () => {
    const { agent, collectionId } = await withCollection();
    expect(
      (
        await agent.put(`/api/external-collections/${collectionId}/items/req-get/rename`).send({
            method: "GET",
            url: "{{baseUrl}}/customers",
            headers: [{ key: "Cookie", value: "session=configured-secret" }],
          })
      ).status,
    ).toBe(200);
    const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({
        name: "Credentials",
        source: { kind: "collection", collectionId, orderedRequestIds: ["req-get"] },
      });
    expect(seeded.status).toBe(201);
    expect(seeded.body.movedCredentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: { kind: "header", name: "Cookie" } }),
      ]),
    );
    expect(
      seeded.body.plan.seedingReport.items.some(
        (item: { kind: string }) => item.kind === "literal-credential-dropped",
      ),
    ).toBe(false);
    expect(JSON.stringify(seeded.body)).not.toContain("configured-secret");
  });

  it("honors an explicit environment or no environment instead of copying collection settings", async () => {
    const { agent, collectionId } = await withCollection();
    const input = {
      name: "Original",
      source: { kind: "collection", collectionId, orderedRequestIds: TWO_FOLDER_REQUEST_IDS },
    };
    const first = await agent.post(`${CHAIN_BASE}/seed`).send(input);
    expect(first.status).toBe(201);
    const environmentId = first.body.plan.targetEnvironmentId as string;
    const chosen = await agent.post(`${CHAIN_BASE}/seed`).send({ ...input, name: "Override", environmentId });
    expect(chosen.status).toBe(201);
    expect(chosen.body.plan.targetEnvironmentId).toBe(environmentId);
    const none = await agent.post(`${CHAIN_BASE}/seed`).send({ ...input, name: "Without environment", environmentId: null });
    expect(none.status).toBe(201);
    expect(none.body.plan.targetEnvironmentId).toBeNull();
    expect(
      (await agent.get("/api/test-generation-workflow/environments")).body.environments,
    ).toHaveLength(1);
  });
});
