import { randomUUID } from "node:crypto";
import type { ExecutionRun, RequestResult } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { enterTestSession } from "../../../src/session/sessionContext";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getExecutionRunRepository } from "../../../src/persistence/executionRunRepository";

/**
 * specs/029-execution-gap-closure FR-015 / research.md D7: results are a JSON column, so a result
 * stored before specs/029 (no `processingStage`, no `unmetDependencies`) must read back unchanged,
 * and appending a new-shape result next to it must keep both intact. No migration is involved.
 */

function inProgressRun(): ExecutionRun {
  return {
    id: randomUUID(),
    workflowId: "workflow-1",
    environmentId: "env-1",
    environmentSnapshot: { name: "Dev", tier: "dev", baseUrl: "http://127.0.0.1:1" },
    status: "in-progress",
    startedAt: "2026-09-01T00:00:00.000Z",
    summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
    results: [],
    cancelRequested: false,
  };
}

/** Exactly the shape a pre-specs/029 run stored. */
const legacyResult: RequestResult = {
  scenarioId: "scenario-legacy",
  operationPath: "/pets",
  operationMethod: "GET",
  outcome: "passed",
  startedAt: "2026-09-01T00:00:00.000Z",
  durationMs: 12,
  responseStatusCode: 200,
  assertionOutcomes: [{ assertionIndex: 0, type: "status-code", outcome: "passed" }],
};

const currentResult: RequestResult = {
  scenarioId: "scenario-current",
  operationPath: "/pets/{petId}",
  operationMethod: "GET",
  outcome: "not-attempted",
  notAttemptedReason: "dependency-not-met",
  unmetDependencies: [{ scenarioId: "scenario-legacy", operationPath: "/pets", operationMethod: "GET" }],
  processingStage: "not-sent",
  startedAt: "2026-09-01T00:00:01.000Z",
  durationMs: 0,
  assertionOutcomes: [],
};

describe("executionRunRepository — results stored before specs/029 (FR-015)", () => {
  it("reads back a stored result without processingStage or unmetDependencies unchanged", () => {
    const repository = getExecutionRunRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const run = inProgressRun();
    repository.create(sessionId, run);
    // Written straight into the column, as an older backend would have left it.
    getSharedConnection()
      .db.prepare("UPDATE execution_runs SET results = ? WHERE session_id = ? AND id = ?")
      .run(JSON.stringify([legacyResult]), sessionId, run.id);

    const fetched = repository.get(sessionId, run.id);
    expect(fetched?.results).toEqual([legacyResult]);
    expect(fetched?.results[0]).not.toHaveProperty("processingStage");
    expect(fetched?.results[0]).not.toHaveProperty("unmetDependencies");
    expect(repository.listBySession(sessionId).map((listed) => listed.id)).toEqual([run.id]);
  });

  it("appends a new-shape result next to a legacy one, keeping both intact", () => {
    const repository = getExecutionRunRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const run = inProgressRun();
    repository.create(sessionId, run);
    getSharedConnection()
      .db.prepare("UPDATE execution_runs SET results = ? WHERE session_id = ? AND id = ?")
      .run(JSON.stringify([legacyResult]), sessionId, run.id);

    const updated = repository.appendResult(sessionId, run.id, currentResult);

    expect(updated.results).toEqual([legacyResult, currentResult]);
    expect(repository.get(sessionId, run.id)?.results).toEqual([legacyResult, currentResult]);
    expect(updated.summary).toMatchObject({ total: 2, passed: 1, notAttempted: 1 });
  });
});
