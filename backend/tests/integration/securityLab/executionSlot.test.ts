import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UserScriptRun } from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import { findExecutionInProgress } from "../../../src/execution/executionSlot";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { getUserScriptRunRepository } from "../../../src/persistence/userScriptRunRepository";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import { runWithSession } from "../../../src/session/sessionContext";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { establishSession } from "../../fixtures/performance/session";
import { makeRun, OWNER_A } from "../../fixtures/securityLab/builders";
import { approve, generateAll, scenarioIds, startHarness, startRun, type Harness } from "../../fixtures/securityLab/runHarness";

/**
 * specs/057 FR-047, tasks T092 and T101: a Security Lab run takes the one session-wide execution slot, so every other
 * start route refuses while it runs, and a Security Lab start refuses while any other execution runs. The slot is
 * per session, so another session is unaffected.
 */

function userScriptRun(id: string): UserScriptRun {
  return {
    id,
    source: "user-script",
    status: "in-progress",
    environment: { id: "e1", name: "Local", tier: "local", baseUrl: "http://127.0.0.1:9" },
    snapshot: { scriptId: "s1", scriptName: "s", scriptSha256: "x", load: { kind: "script" }, mapping: [], thresholds: [], hostsFound: [] },
    k6Version: "1.2.0",
    k6ExitCode: null,
    exitMeaning: null,
    plannedDurationMs: null,
    startedAt: "2026-10-01T10:00:00.000Z",
    cancelRequested: false,
  };
}

const harnesses: Harness[] = [];
afterEach(async () => {
  await settleActiveRuns();
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
});

describe("a Security Lab run in the shared execution slot", () => {
  beforeEach(() => resetStore());

  it("is found by the slot for its own session, and for no other", () => {
    getSecurityRunRepository().createRun(makeRun({ id: "sec-run-1", ownerId: OWNER_A, sessionId: "session-a", status: "in-progress" }));
    expect(runWithSession("session-a", () => findExecutionInProgress())).toEqual({ runId: "sec-run-1" });
    expect(runWithSession("session-b", () => findExecutionInProgress())).toBeNull();
  });

  it("frees the slot as soon as the run settles", () => {
    getSecurityRunRepository().createRun(makeRun({ id: "sec-run-2", ownerId: OWNER_A, sessionId: "session-a", status: "in-progress" }));
    getSecurityRunRepository().updateRun(OWNER_A, "sec-run-2", { status: "completed", completedAt: "2026-01-01T00:00:00.000Z" });
    expect(runWithSession("session-a", () => findExecutionInProgress())).toBeNull();
  });

  it("makes a generated-collection start return 409 execution_in_progress", async () => {
    const agent = request.agent(createApp());
    const sessionId = await establishSession(agent);
    await driveToPostmanGenerationComplete(agent);
    const env = await agent.post("/api/test-generation-workflow/environments").send({ name: "Local", tier: "local", baseUrl: "http://127.0.0.1:9", variableValues: { apiKey: "k" } });
    getSecurityRunRepository().createRun(makeRun({ id: "sec-run-3", ownerId: OWNER_A, sessionId, status: "in-progress" }));

    const refused = await agent.post("/api/test-generation-workflow/execution/start").send({ environmentId: env.body.environment.id, confirmed: true });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "sec-run-3" });
  }, 30_000);

  it("is refused to start while a user-script run is in progress, and nothing is sent", async () => {
    const h = await startHarness();
    harnesses.push(h);
    await generateAll(h);
    const items = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`);
    await approve(h, items);
    getUserScriptRunRepository().create(h.sessionId, userScriptRun("user-run-1"));

    const refused = await startRun(h, items);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "user-run-1" });
    expect(h.target.requests).toEqual([]);
    expect(getSecurityRunRepository().listRuns(h.ownerId)).toEqual([]);
  });

  it("does not stop another session from running", async () => {
    const first = await startHarness();
    harnesses.push(first);
    await generateAll(first);
    const items = await scenarioIds(first, `operation=${encodeURIComponent("GET /orders")}&category=authentication`);
    await approve(first, items);
    getSecurityRunRepository().createRun(makeRun({ id: "sec-run-other", ownerId: OWNER_A, sessionId: "some-other-session", status: "in-progress" }));
    const started = await startRun(first, items);
    expect(started.status).toBe(202);
  });
});
