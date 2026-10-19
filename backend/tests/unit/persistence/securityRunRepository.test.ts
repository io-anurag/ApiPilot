import { describe, expect, it } from "vitest";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { OWNER_A, OWNER_B, T0, T1, makeResult, makeRun } from "../../fixtures/securityLab/builders";

describe("SecurityRunRepository", () => {
  it("stores a run and reads it back only for its owner", () => {
    const repo = getSecurityRunRepository();
    const run = makeRun();
    repo.createRun(run);
    expect(repo.getRun(OWNER_A, "run-1")).toEqual(run);
    expect(repo.getRun(OWNER_B, "run-1")).toBeUndefined();
    expect(repo.countRuns(OWNER_A)).toBe(1);
    expect(repo.countRuns(OWNER_B)).toBe(0);
  });

  it("lists runs newest first, optionally for one assessment", () => {
    const repo = getSecurityRunRepository();
    repo.createRun(makeRun({ id: "run-old", startedAt: T0, assessmentKey: "k1" }));
    repo.createRun(makeRun({ id: "run-new", startedAt: T1, assessmentKey: "k2" }));
    expect(repo.listRuns(OWNER_A).map((r) => r.id)).toEqual(["run-new", "run-old"]);
    expect(repo.listRuns(OWNER_A, "k1").map((r) => r.id)).toEqual(["run-old"]);
  });

  it("finds the run in progress for a session, and not for another", () => {
    const repo = getSecurityRunRepository();
    repo.createRun(makeRun({ id: "run-1", sessionId: "s-1" }));
    expect(repo.getInProgress("s-1")?.id).toBe("run-1");
    expect(repo.getInProgress("s-2")).toBeUndefined();
    repo.updateRun(OWNER_A, "run-1", { status: "completed", completedAt: T1 });
    expect(repo.getInProgress("s-1")).toBeUndefined();
  });

  it("applies a partial update to progress, cancellation and cleanup", () => {
    const repo = getSecurityRunRepository();
    repo.createRun(makeRun());
    repo.updateRun(OWNER_A, "run-1", { budget: { planned: 4, used: 2 }, cancelRequested: true, cancelReason: "user-requested" });
    expect(repo.getRun(OWNER_A, "run-1")).toMatchObject({
      budget: { planned: 4, used: 2 },
      cancelRequested: true,
      cancelReason: "user-requested",
      status: "in-progress",
    });
    const cleanup = [{ scenarioId: "ss-1", action: "DELETE /orders/7", state: "failed" as const, detail: "target returned 500", leftBehind: "order 7", manualRemoval: "delete order 7 by hand" }];
    repo.updateRun(OWNER_A, "run-1", {
      status: "cancelled",
      completedAt: T1,
      cleanup,
      summary: { passed: 1, failed: 0, inconclusive: 0, blocked: 0, errored: 0, not_run: 3 },
    });
    expect(repo.getRun(OWNER_A, "run-1")).toMatchObject({ status: "cancelled", completedAt: T1, cleanup });
  });

  it("settles every run left in progress after a restart, for every owner", () => {
    const repo = getSecurityRunRepository();
    repo.createRun(makeRun({ id: "run-a", ownerId: OWNER_A, sessionId: "s-1" }));
    repo.createRun(makeRun({ id: "run-b", ownerId: OWNER_B, sessionId: "s-2" }));
    repo.createRun(makeRun({ id: "run-done", ownerId: OWNER_A, sessionId: "s-1", status: "completed", completedAt: T0 }));
    expect(repo.markInterruptedRunsCancelled(T1)).toBe(2);
    expect(repo.getRun(OWNER_A, "run-a")).toMatchObject({ status: "cancelled", cancelReason: "backend-restart", completedAt: T1 });
    expect(repo.getRun(OWNER_B, "run-b")?.status).toBe("cancelled");
    expect(repo.getRun(OWNER_A, "run-done")?.status).toBe("completed");
  });

  it("appends per-scenario results and reads them by run and by scenario version", () => {
    const repo = getSecurityRunRepository();
    repo.createRun(makeRun({ id: "run-1" }));
    repo.createRun(makeRun({ id: "run-2", startedAt: T1 }));
    repo.appendResult(OWNER_A, makeResult({ id: "r-1", runId: "run-1", startedAt: T0 }));
    repo.appendResult(OWNER_A, makeResult({ id: "r-2", runId: "run-2", startedAt: T1, outcome: "passed" }));
    repo.appendResult(OWNER_A, makeResult({ id: "r-3", runId: "run-2", scenarioId: "ss-other", startedAt: T1 }));
    expect(repo.listResults(OWNER_A, "run-2").map((r) => r.id)).toEqual(["r-2", "r-3"]);
    expect(repo.listResultsForScenario(OWNER_A, "ss-0000000000000001").map((r) => r.id)).toEqual(["r-1", "r-2"]);
    expect(repo.listResultsForScenario(OWNER_A, "ss-0000000000000001", 2)).toEqual([]);
    expect(repo.getResult(OWNER_A, "r-2")?.outcome).toBe("passed");
    expect(repo.getResult(OWNER_B, "r-2")).toBeUndefined();
    expect(repo.listResults(OWNER_B, "run-2")).toEqual([]);
  });

  it("keeps no evidence body: a stored result carries only the bounded observed summary", () => {
    const repo = getSecurityRunRepository();
    repo.createRun(makeRun());
    repo.appendResult(OWNER_A, makeResult());
    const stored = repo.getResult(OWNER_A, "result-1");
    expect(Object.keys(stored ?? {})).not.toContain("evidence");
    expect(JSON.stringify(stored)).not.toMatch(/responseBodyExcerpt|requestBodyExcerpt/);
  });

  it("stores the owner's sensitive field names", () => {
    const repo = getSecurityRunRepository();
    expect(repo.getSensitiveFields(OWNER_A)).toEqual([]);
    repo.setSensitiveFields(OWNER_A, ["ssn", "iban"], T0);
    repo.setSensitiveFields(OWNER_A, ["ssn"], T1);
    expect(repo.getSensitiveFields(OWNER_A)).toEqual(["ssn"]);
    expect(repo.getSensitiveFields(OWNER_B)).toEqual([]);
  });

  it("deletes one assessment's runs and results, then everything for an owner", () => {
    const repo = getSecurityRunRepository();
    repo.createRun(makeRun({ id: "run-1", assessmentKey: "k1" }));
    repo.createRun(makeRun({ id: "run-2", assessmentKey: "k2" }));
    repo.createRun(makeRun({ id: "run-b", ownerId: OWNER_B, assessmentKey: "k1" }));
    repo.appendResult(OWNER_A, makeResult({ id: "r-1", runId: "run-1" }));
    repo.appendResult(OWNER_A, makeResult({ id: "r-2", runId: "run-2" }));
    repo.setSensitiveFields(OWNER_A, ["ssn"], T0);
    expect(repo.deleteAssessment(OWNER_A, "k1")).toEqual({ runs: 1 });
    expect(repo.getRun(OWNER_A, "run-1")).toBeUndefined();
    expect(repo.getResult(OWNER_A, "r-1")).toBeUndefined();
    expect(repo.getRun(OWNER_A, "run-2")).toBeDefined();
    expect(repo.getRun(OWNER_B, "run-b")).toBeDefined();
    expect(repo.deleteOwner(OWNER_A)).toEqual({ runs: 1 });
    expect(repo.countRuns(OWNER_A)).toBe(0);
    expect(repo.getResult(OWNER_A, "r-2")).toBeUndefined();
    expect(repo.getSensitiveFields(OWNER_A)).toEqual([]);
    expect(repo.getRun(OWNER_B, "run-b")).toBeDefined();
  });
});
