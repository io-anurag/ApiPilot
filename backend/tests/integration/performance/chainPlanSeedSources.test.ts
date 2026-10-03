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
});
