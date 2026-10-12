import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../fixtures/execution/driveWorkflow";
import { TargetServer } from "../fixtures/execution/targetServer";
import { VALID_SPECIFICATION_FILENAME, validSpecificationBuffer } from "../fixtures/testGenerationWorkflow/workflowFixtures";

/** specs/048-workflow-run-stage-status US1: Execution completes when a run of the workflow's own upload completes. */

type Agent = ReturnType<typeof request.agent>;

function collectionWith(requestCount: number) {
  return {
    info: { name: "Handed over", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: Array.from({ length: requestCount }, (_, index) => ({
      id: `0b8f4f7e-2a4c-5d1e-9f3a-7c6b5a4d3e2${index}`,
      name: `Get widget ${index}`,
      request: { method: "GET", url: "{{baseUrl}}/widgets/1" },
    })),
  };
}

async function upload(
  agent: Agent,
  baseUrl: string,
  options: { name?: string; workflowId?: string; requests?: number; delayMs?: number } = {},
): Promise<string> {
  const call = agent
    .post("/api/external-collections")
    .field("name", options.name ?? "Handed over")
    .field("tier", "local")
    .field("requestDelayMs", String(options.delayMs ?? 0))
    .attach("collection", Buffer.from(JSON.stringify(collectionWith(options.requests ?? 1))), "collection.json")
    .attach(
      "environment",
      Buffer.from(JSON.stringify({ name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] })),
      "environment.json",
    );
  const response = options.workflowId === undefined ? await call : await call.field("workflowId", options.workflowId);
  expect(response.status).toBe(201);
  return response.body.uploadedCollection.id as string;
}

async function startRun(agent: Agent, uploadId: string): Promise<string> {
  const started = await agent.post(`/api/external-collections/${uploadId}/execution/start`).send({ confirmed: true });
  expect(started.status).toBe(200);
  return started.body.run.id as string;
}

async function settled(agent: Agent, uploadId: string, runId: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${uploadId}/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") return response.body.run.status as string;
    if (Date.now() > deadline) throw new Error("Run never settled.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The workflow with the three fields a qualifying run is allowed to change set to fixed values. */
function withoutRunEffects(workflow: TestGenerationWorkflow): TestGenerationWorkflow {
  return {
    ...workflow,
    updatedAt: "",
    stages: { ...workflow.stages, execution: { ...workflow.stages.execution, status: "active", completedAt: undefined } },
  };
}

async function currentWorkflow(agent: Agent): Promise<TestGenerationWorkflow> {
  const response = await agent.get("/api/test-generation-workflow");
  expect(response.status).toBe(200);
  return response.body.workflow as TestGenerationWorkflow;
}

describe("Execution stage completes from a finished run (specs/048 US1)", () => {
  let targetServer: TargetServer;
  let baseUrl: string;

  beforeEach(async () => {
    resetStore();
    targetServer = new TargetServer();
    baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: { id: 1 } });
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  async function driven(): Promise<{ agent: Agent; workflow: TestGenerationWorkflow }> {
    const agent = request.agent(createApp());
    const workflow = await driveToPostmanGenerationComplete(agent);
    expect(workflow.stages.execution.status).toBe("active");
    return { agent, workflow };
  }

  it("completes Execution when a run of the linked upload completes, changing only the stage fields", async () => {
    const { agent, workflow: before } = await driven();
    const uploadId = await upload(agent, baseUrl, { workflowId: before.id });
    const runId = await startRun(agent, uploadId);
    expect(await settled(agent, uploadId, runId)).toBe("completed");

    const after = await currentWorkflow(agent);
    expect(after.stages.execution.status).toBe("complete");
    expect(after.stages.execution.completedAt).toBeDefined();
    // FR-015: no run content was copied into the workflow; only the stage status, its completion
    // time and the workflow's update time differ.
    expect(withoutRunEffects(after)).toEqual(withoutRunEffects(before));
  }, 60_000);

  it("completes Execution for a run that stopped on an error (recorded as completed)", async () => {
    const { agent, workflow } = await driven();
    const uploadId = await upload(agent, "http://127.0.0.1:1", { workflowId: workflow.id });
    const runId = await startRun(agent, uploadId);
    expect(await settled(agent, uploadId, runId)).toBe("completed");
    expect((await currentWorkflow(agent)).stages.execution.status).toBe("complete");
  }, 60_000);

  it("leaves Execution active after a cancelled run", async () => {
    const { agent, workflow } = await driven();
    const uploadId = await upload(agent, baseUrl, { workflowId: workflow.id, requests: 2, delayMs: 1_000 });
    const runId = await startRun(agent, uploadId);
    await agent.post(`/api/external-collections/${uploadId}/execution/cancel`);
    expect(await settled(agent, uploadId, runId)).toBe("cancelled");
    expect((await currentWorkflow(agent)).stages.execution.status).toBe("active");
  }, 60_000);

  it("leaves Execution active for an upload without a workflowId or with another workflow's id", async () => {
    const { agent } = await driven();
    const plain = await upload(agent, baseUrl, { name: "Plain" });
    expect(await settled(agent, plain, await startRun(agent, plain))).toBe("completed");
    const other = await upload(agent, baseUrl, { name: "Other", workflowId: "wf-1-1" });
    expect(await settled(agent, other, await startRun(agent, other))).toBe("completed");
    expect((await currentWorkflow(agent)).stages.execution.status).toBe("active");
  }, 60_000);

  it("leaves a skipped Execution skipped", async () => {
    const { agent, workflow } = await driven();
    await agent.post("/api/test-generation-workflow/execution/skip");
    const uploadId = await upload(agent, baseUrl, { workflowId: workflow.id });
    expect(await settled(agent, uploadId, await startRun(agent, uploadId))).toBe("completed");
    expect((await currentWorkflow(agent)).stages.execution.status).toBe("skipped");
  }, 60_000);

  it("keeps the completion time when a second run completes", async () => {
    const { agent, workflow } = await driven();
    const uploadId = await upload(agent, baseUrl, { workflowId: workflow.id });
    expect(await settled(agent, uploadId, await startRun(agent, uploadId))).toBe("completed");
    const first = (await currentWorkflow(agent)).stages.execution;
    expect(await settled(agent, uploadId, await startRun(agent, uploadId))).toBe("completed");
    const second = (await currentWorkflow(agent)).stages.execution;
    expect(second).toEqual(first);
  }, 60_000);

  it("still completes when the upload is deleted while its run is in progress", async () => {
    const { agent, workflow } = await driven();
    const uploadId = await upload(agent, baseUrl, { workflowId: workflow.id, requests: 2, delayMs: 300 });
    const runId = await startRun(agent, uploadId);
    await agent.delete(`/api/external-collections/${uploadId}`);
    const deadline = Date.now() + 30_000;
    while ((await currentWorkflow(agent)).stages.execution.status !== "complete") {
      if (Date.now() > deadline) throw new Error(`Execution never completed (run ${runId}).`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, 60_000);

  it("does not fail a run when the workflow was discarded, and leaves a new workflow unchanged", async () => {
    const { agent, workflow } = await driven();
    const uploadId = await upload(agent, baseUrl, { workflowId: workflow.id, requests: 2, delayMs: 300 });
    const runId = await startRun(agent, uploadId);
    expect((await agent.delete("/api/test-generation-workflow")).status).toBe(204);
    const replacement = await agent
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    expect(replacement.status).toBeLessThan(300);
    expect(await settled(agent, uploadId, runId)).toBe("completed");
    const current = await currentWorkflow(agent);
    expect(current.id).not.toBe(workflow.id);
    expect(current.stages.execution.status).toBe("not-yet-reached");
  }, 60_000);

  it("gives the same stage statuses when the same sequence is repeated in a fresh session (FR-013)", async () => {
    const statuses: string[][] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { agent, workflow } = await driven();
      const uploadId = await upload(agent, baseUrl, { workflowId: workflow.id });
      await settled(agent, uploadId, await startRun(agent, uploadId));
      const after = await currentWorkflow(agent);
      statuses.push(Object.values(after.stages).map((stage) => `${stage.stageId}:${stage.status}`));
    }
    expect(statuses[1]).toEqual(statuses[0]);
  }, 120_000);
});
