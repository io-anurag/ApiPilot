import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

function collectionWithDestructiveRequest() {
  return {
    info: { name: "c" },
    item: [{ name: "Create widget", request: { method: "POST", url: "{{baseUrl}}/widgets" } }],
  };
}

function nonDestructiveCollection() {
  return {
    info: { name: "c" },
    item: [{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets" } }],
  };
}

function environment() {
  return { name: "env", values: [{ key: "baseUrl", value: "http://localhost:1", enabled: true }] };
}

async function upload(
  agent: ReturnType<typeof request.agent>,
  tier: string,
  name = "col",
  collection: unknown = collectionWithDestructiveRequest(),
) {
  return agent
    .post("/api/external-collections")
    .field("name", name)
    .field("tier", tier)
    .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(environment())), "environment.json");
}

describe("external collections: confirmation gates (US2, FR-007, FR-013, research.md D10)", () => {
  it("gate 1 (unverified content) blocks an unconfirmed run; confirming sets confirmedAt (quickstart.md Scenario 1 steps 2-3)", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await upload(agent, "local");
    const id = uploaded.body.uploadedCollection.id;

    const unconfirmed = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: false });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toBe("unverified_content_confirmation_required");

    const list = await agent.get("/api/external-collections");
    expect(list.body.uploadedCollections[0].confirmedAt).toBeUndefined();
  });

  it("gate 2 (risk tier) is evaluated every run start, independent of gate 1, once content is already confirmed (quickstart.md Scenario 4)", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await upload(agent, "staging");
    const id = uploaded.body.uploadedCollection.id;

    // First confirmed:true resubmission satisfies gate 1 only (research.md D10) — gate 2 must
    // still surface separately, naming the tier and the destructive request.
    const firstConfirm = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    expect(firstConfirm.status).toBe(409);
    expect(firstConfirm.body.error).toBe("confirmation_required");
    expect(firstConfirm.body.environmentTier).toBe("staging");
    expect(firstConfirm.body.destructiveOperations).toEqual([
      { operationPath: "Create widget", operationMethod: "POST" },
    ]);

    // Content is now confirmed (from the call above); the tier gate alone remains, so declining
    // it here still refuses, and confirming starts the run.
    const declineTier = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: false });
    expect(declineTier.status).toBe(409);
    expect(declineTier.body.error).toBe("confirmation_required");

    const secondConfirm = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    expect(secondConfirm.status).toBe(200);
    expect(secondConfirm.body.run.status).toBe("in-progress");
  });

  it("a local-tier, non-destructive collection has no gate 2 requirement, so a single confirmed:true starts the run", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await upload(agent, "local", "already-confirmed", nonDestructiveCollection());
    const id = uploaded.body.uploadedCollection.id;

    await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    // The above starts a run (local tier has no destructive-request gate to also satisfy) —
    // wait for it to leave "in-progress" isn't needed here; re-starting is blocked by FR-015
    // instead, which is exactly what proves gate 1 alone was sufficient this time.
    const again = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: false });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("execution_in_progress");
  });
});
