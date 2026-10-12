import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

/** specs/048-workflow-run-stage-status D1: the optional `workflowId` field of the upload. */

const collection = {
  info: { name: "My collection", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  item: [{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets/1" } }],
};
const environment = { name: "My environment", values: [{ key: "baseUrl", value: "http://127.0.0.1:1", enabled: true }] };

function upload(agent: ReturnType<typeof request.agent>, name: string, workflowId?: string) {
  const call = agent
    .post("/api/external-collections")
    .field("name", name)
    .field("tier", "local")
    .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(environment)), "environment.json");
  return workflowId === undefined ? call : call.field("workflowId", workflowId);
}

describe("external collections: workflowId on upload (specs/048)", () => {
  it("accepts a well-formed workflowId and does not return it", async () => {
    const agent = request.agent(createApp());
    const response = await upload(agent, "Linked", "wf-1760000000000-1");
    expect(response.status).toBe(201);
    expect(response.body.uploadedCollection.sourceWorkflowId).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("wf-1760000000000-1");
  });

  it("rejects a malformed workflowId with 400 invalid_request and creates nothing", async () => {
    const agent = request.agent(createApp());
    const response = await upload(agent, "Bad link", "not-a-workflow");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_request", message: "workflowId must be a workflow id" });
    const list = await agent.get("/api/external-collections");
    expect(list.body.uploadedCollections).toEqual([]);
  });

  it("behaves as before without a workflowId", async () => {
    const agent = request.agent(createApp());
    const response = await upload(agent, "Plain");
    expect(response.status).toBe(201);
  });
});
