import request from "supertest";
import type { CoverageSnapshot, TestScenario } from "@apipilot/shared-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { itemIdForScenario } from "../../src/postman/identifiers";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../fixtures/execution/driveWorkflow";
import { TargetServer } from "../fixtures/execution/targetServer";

/**
 * AP-046 against the real application: a real workflow (upload, generation, review, finalize,
 * Postman generation) and a real Newman run against a local target server, read back through the
 * real coverage route. Nothing here is a hand-built snapshot: it proves the evidence join and the
 * scenario mapping hold for what the generator and the executor actually produce.
 */
const POLL_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 90_000;

async function pollUntilSettled(agent: ReturnType<typeof request.agent>, runId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const response = await agent.get(`/api/test-generation-workflow/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") return;
    if (Date.now() > deadline) throw new Error(`Run ${runId} never settled.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function collectItemIds(items: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const item of list as { id?: string; item?: unknown }[]) {
      if (typeof item.id === "string") ids.add(item.id);
      visit(item.item);
    }
  };
  visit(items);
  return ids;
}

describe("coverage against a real workflow and a real run", () => {
  let target: TargetServer;
  beforeEach(() => {
    resetStore();
    target = new TargetServer();
  });
  afterEach(async () => {
    await target.stop();
  });

  it(
    "reports generated-only coverage, then verified coverage from real evidence, and the collection's item ids match the join",
    async () => {
      const baseUrl = await target.start();
      target.configure("GET", "/pets", { status: 200, body: [{ id: 1, name: "Rex", status: "available" }] });
      target.configure("POST", "/pets", { status: 201, body: { id: 2, name: "Fido" } });
      target.configure("GET", "/pets/1", { status: 200, body: { id: 1, name: "Rex" } });

      const agent = request.agent(createApp());
      const workflow = await driveToPostmanGenerationComplete(agent, {
        accept: (scenario: TestScenario) => scenario.operationMethod === "GET",
      });
      const accepted = (workflow.reviewWorkspace?.scenarios ?? []).filter((s) => s.state === "accepted");
      const pending = (workflow.reviewWorkspace?.scenarios ?? []).filter((s) => s.state === "pending");
      expect(accepted.length).toBeGreaterThan(0);
      expect(pending.length).toBeGreaterThan(0);

      // The join assumption: every approved scenario's request carries exactly the id coverage computes.
      const itemIds = collectItemIds(workflow.postmanArtifact?.collection.item);
      for (const review of accepted) expect(itemIds.has(itemIdForScenario(review.scenario.id))).toBe(true);

      // Before any run: specification coverage from real scenarios, nothing verified.
      const before = (await agent.get("/api/coverage")).body as CoverageSnapshot;
      expect(before.context.scenarioCounts).toMatchObject({ accepted: accepted.length, pending: pending.length, rejected: 0 });
      expect(before.metrics.find((m) => m.id === "spec-operations")?.numerator).toBeGreaterThan(0);
      expect(before.metrics.find((m) => m.id === "runtime-operations")?.numerator).toBe(0);
      expect(before.execution.runIds).toEqual([]);
      expect(before.requirements.some((r) => r.state === "verified")).toBe(false);
      // Pending scenarios count toward specification coverage (clarified 2026-10-10): the POST
      // operation has only pending scenarios and is covered, but generated and not executed.
      expect(before.requirements.find((r) => r.id === "op:POST /pets")).toMatchObject({
        state: "generated-not-executed",
        acceptedCount: 0,
      });

      // Run the approved collection for real, then read coverage back.
      const env = await agent
        .post("/api/test-generation-workflow/environments")
        .send({ name: "Local", tier: "local", baseUrl, variableValues: { apiKey: "test-key" } });
      const started = await agent
        .post("/api/test-generation-workflow/execution/start")
        .send({ environmentId: env.body.environment.id, confirmed: true });
      expect(started.status).toBe(200);
      await pollUntilSettled(agent, started.body.run.id);

      const after = (await agent.get("/api/coverage")).body as CoverageSnapshot;
      expect(after.execution.sources).toEqual(["guided"]);
      expect(after.execution.runIds).toEqual([started.body.run.id]);
      expect(after.execution.unattributedResults).toBe(0);
      expect(after.execution.lastQualifyingExecutionAt).toBeDefined();
      expect(after.metrics.find((m) => m.id === "runtime-assertions")?.denominator).toBeGreaterThan(0);
      // Real evidence moved at least one requirement out of "generated, not executed" ...
      expect(after.requirements.some((r) => r.state === "verified" || r.state === "executed-failed")).toBe(true);
      // ... every state is a real classification, and specification coverage is unchanged by running.
      expect(after.metrics.find((m) => m.id === "spec-operations")?.numerator).toBe(
        before.metrics.find((m) => m.id === "spec-operations")?.numerator,
      );
      // The collection holds only the accepted GET scenarios, so the pending POST operation stays generated, not executed.
      expect(after.requirements.find((r) => r.id === "op:POST /pets")?.state).toBe("generated-not-executed");
      // Nothing is verified unless an executed scenario backs it.
      for (const requirement of after.requirements.filter((r) => r.state === "verified")) {
        expect(requirement.evidence.length).toBeGreaterThan(0);
        expect(requirement.evidence.every((e) => e.runId === started.body.run.id)).toBe(true);
      }
      expect(JSON.stringify(after)).not.toMatch(/test-key/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reads evidence from an uploaded run of the generated collection, as the Import & Run screen produces it",
    async () => {
      const baseUrl = await target.start();
      target.configure("GET", "/pets", { status: 200, body: [{ id: 1, name: "Rex", status: "available" }] });
      target.configure("GET", "/pets/1", { status: 200, body: { id: 1, name: "Rex" } });

      const agent = request.agent(createApp());
      const workflow = await driveToPostmanGenerationComplete(agent, {
        accept: (scenario: TestScenario) => scenario.operationMethod === "GET",
      });
      const artifact = workflow.postmanArtifact;
      if (!artifact) throw new Error("no Postman artifact");
      const environment = structuredClone(artifact.environment) as { values?: { key: string; value: string; enabled?: boolean }[] };
      environment.values = (environment.values ?? []).map((v) => (v.key === "baseUrl" ? { ...v, value: baseUrl } : v));

      const upload = await agent
        .post("/api/external-collections")
        .field("name", "Generated collection")
        .field("tier", "local")
        .attach("collection", Buffer.from(JSON.stringify(artifact.collection)), "collection.json")
        .attach("environment", Buffer.from(JSON.stringify(environment)), "environment.json");
      expect(upload.status).toBe(201);
      const id = upload.body.uploadedCollection.id as string;
      const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
      expect(started.status).toBe(200);
      const runId = started.body.run.id as string;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        const response = await agent.get(`/api/external-collections/${id}/execution/runs/${runId}`);
        if (response.body.run.status !== "in-progress") break;
        if (Date.now() > deadline) throw new Error("uploaded run never settled");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const snapshot = (await agent.get("/api/coverage")).body as CoverageSnapshot;
      expect(snapshot.execution.sources).toEqual(["uploaded"]);
      expect(snapshot.execution.runIds).toEqual([runId]);
      expect(snapshot.execution.availableRuns.map((r) => r.id)).toEqual([runId]);
      // The generated items join to scenarios, so nothing the run did is unattributed, and the
      // assertion names recovered from the collection's tests drive real verdicts.
      expect(snapshot.execution.unattributedResults).toBe(0);
      expect(snapshot.metrics.find((m) => m.id === "runtime-assertions")?.denominator).toBeGreaterThan(0);
      expect(snapshot.requirements.some((r) => r.state === "verified" || r.state === "executed-failed")).toBe(true);
      expect(snapshot.requirements.filter((r) => r.state === "verified").every((r) => r.evidence.length > 0)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
