import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getFailureAnalysisRepository } from "../../../src/persistence/failureAnalysisRepository";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import "../../../src/failureAnalysis/failureAnalysisStore";
import { sampleAnalysis, unavailableExplanation } from "../../fixtures/failureAnalysis/fixtures";

describe("failureAnalysisRepository", () => {
  it("round-trips an analysis through upsert and get", () => {
    const repository = getFailureAnalysisRepository();
    const sessionId = randomUUID();
    const analysis = sampleAnalysis();

    repository.upsert(sessionId, analysis);

    expect(repository.get(sessionId, "run-1", 0)).toEqual(analysis);
  });

  it("replaces an existing analysis for the same result completely (FR-015)", () => {
    const repository = getFailureAnalysisRepository();
    const sessionId = randomUUID();
    repository.upsert(sessionId, sampleAnalysis());
    const replacement = sampleAnalysis({
      conclusion: { kind: "insufficient-evidence", reason: "no-rule-matched" },
      explanation: unavailableExplanation(),
    });

    repository.upsert(sessionId, replacement);

    expect(repository.get(sessionId, "run-1", 0)).toEqual(replacement);
    expect(repository.listByRun(sessionId, "run-1")).toHaveLength(1);
  });

  it("lists a run's analyses ordered by result position, scoped to the session", () => {
    const repository = getFailureAnalysisRepository();
    const sessionId = randomUUID();
    const otherSession = randomUUID();
    repository.upsert(sessionId, sampleAnalysis({ resultIndex: 3 }));
    repository.upsert(sessionId, sampleAnalysis({ resultIndex: 1 }));
    repository.upsert(sessionId, sampleAnalysis({ runId: "run-2", resultIndex: 0 }));
    repository.upsert(otherSession, sampleAnalysis({ resultIndex: 2 }));

    expect(repository.listByRun(sessionId, "run-1").map((a) => a.resultIndex)).toEqual([1, 3]);
    expect(repository.get(otherSession, "run-1", 1)).toBeUndefined();
  });

  it("deleteBySession removes only that session's rows", () => {
    const repository = getFailureAnalysisRepository();
    const sessionId = randomUUID();
    const otherSession = randomUUID();
    repository.upsert(sessionId, sampleAnalysis());
    repository.upsert(otherSession, sampleAnalysis());

    repository.deleteBySession(sessionId);

    expect(repository.listByRun(sessionId, "run-1")).toEqual([]);
    expect(repository.listByRun(otherSession, "run-1")).toHaveLength(1);
  });

  it("deletes an idle-evicted session's analyses through the store's onExpire listener (FR-013)", () => {
    const repository = getFailureAnalysisRepository();
    const sessionId = randomUUID();
    const otherSession = randomUUID();
    repository.upsert(sessionId, sampleAnalysis());
    repository.upsert(otherSession, sampleAnalysis());

    forceExpireForTest(sessionId);

    expect(repository.listByRun(sessionId, "run-1")).toEqual([]);
    expect(repository.listByRun(otherSession, "run-1")).toHaveLength(1);
  });

  it("stores the analysis encrypted, so the summary never appears in plaintext at rest", () => {
    const repository = getFailureAnalysisRepository();
    const sessionId = randomUUID();
    repository.upsert(sessionId, sampleAnalysis());

    const row = getSharedConnection()
      .db.prepare("SELECT analysis_encrypted FROM failure_analyses WHERE session_id = ?")
      .get(sessionId) as { analysis_encrypted: Buffer };

    expect(row.analysis_encrypted.toString("utf-8")).not.toContain("encrypted at rest");
  });

  it("writes analysis_version 2, so startup cleanup keeps the row (research D19)", () => {
    const repository = getFailureAnalysisRepository();
    const sessionId = randomUUID();
    repository.upsert(sessionId, sampleAnalysis());

    const row = getSharedConnection()
      .db.prepare("SELECT analysis_version FROM failure_analyses WHERE session_id = ?")
      .get(sessionId) as { analysis_version: number | null };

    expect(row.analysis_version).toBe(2);
  });
});
