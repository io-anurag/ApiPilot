import { describe, expect, it } from "vitest";
import type { ChainRun } from "@apipilot/shared-domain";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";

/** AP-037 (specs/037-request-chain-performance tasks T013; research R19, R21): chain runs in `performance_runs`. */

const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PLAN_DOCUMENT = JSON.stringify({ chains: [{ steps: [{ url: "{{baseUrl}}/secret-path-MARKER" }] }] });

function chainRun(id: string, overrides: Partial<ChainRun> = {}): ChainRun {
  return {
    id,
    planSource: "chain",
    planId: "p1",
    status: "in-progress",
    environment: { id: "e1", name: "Local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    snapshot: {
      planId: "p1",
      planName: "Customer lifecycle",
      fingerprint: "f1",
      chains: [],
      loadProfile: { kind: "smoke", stages: [{ durationMs: 60000, targetVirtualUsers: 1 }], plannedDurationMs: 60000 },
      thinkTimeMs: 1000,
      thresholds: [],
      hosts: ["{{baseUrl}}"],
      dataSets: [],
      writeSummary: { total: 0, byMethod: [], operations: [] },
      seedSource: null,
      contentNotice: "user-authored-unverified",
    },
    scriptSha256: "sha",
    k6Version: "1.2.0",
    plannedDurationMs: 60000,
    startedAt: "2026-10-03T10:00:00.000Z",
    cancelRequested: false,
    ...overrides,
  };
}

describe("performanceRunRepository: chain runs", () => {
  it("round-trips a chain run and keeps it out of the legacy reads", () => {
    const repository = getPerformanceRunRepository();
    repository.createChainRun(SESSION, chainRun("r1"), PLAN_DOCUMENT);

    expect(repository.getChainRun(SESSION, "r1")).toEqual(chainRun("r1"));
    expect(repository.getChainRun(OTHER, "r1")).toBeUndefined();
    expect(repository.get(SESSION, "r1")).toBeUndefined();
    expect(repository.listBySession(SESSION)).toEqual([]);
    expect(repository.listBySessionAndSource(SESSION, "guided")).toEqual([]);
    expect(repository.getInProgress(SESSION)).toBeUndefined();
    expect(repository.getChainInProgress(SESSION)?.id).toBe("r1");
  });

  it("lists a plan's runs newest first, without snapshot, progress or result", () => {
    const repository = getPerformanceRunRepository();
    repository.createChainRun(SESSION, chainRun("r1", { status: "completed", startedAt: "2026-10-03T10:00:00.000Z" }), PLAN_DOCUMENT);
    repository.createChainRun(SESSION, chainRun("r2", { status: "completed", startedAt: "2026-10-03T11:00:00.000Z" }), PLAN_DOCUMENT);
    repository.createChainRun(SESSION, chainRun("r3", { planId: "p2", status: "completed" }), PLAN_DOCUMENT);
    const runs = repository.listChainRuns(SESSION, "p1");
    expect(runs.map((run) => run.id)).toEqual(["r2", "r1"]);
    expect(runs[0]).not.toHaveProperty("snapshot");
    expect(runs[0].planSource).toBe("chain");
  });

  it("encrypts the run's plan copy and returns it only through its own method", () => {
    const repository = getPerformanceRunRepository();
    repository.createChainRun(SESSION, chainRun("r1"), PLAN_DOCUMENT);
    const row = getSharedConnection().db.prepare("SELECT * FROM performance_runs WHERE id = 'r1'").get() as Record<string, unknown>;
    const text = JSON.stringify(row, (_key, value: unknown) => (Buffer.isBuffer(value) ? value.toString("latin1") : value));
    expect(text).not.toContain("secret-path-MARKER");
    expect(row.chain_plan_id).toBe("p1");
    expect(repository.getChainRunPlanDocument(SESSION, "r1")).toBe(PLAN_DOCUMENT);
    expect(repository.getChainRunPlanDocument(OTHER, "r1")).toBeUndefined();
  });

  it("checkpoints, cancels and settles a chain run with the shared methods", () => {
    const repository = getPerformanceRunRepository();
    repository.createChainRun(SESSION, chainRun("r1"), PLAN_DOCUMENT);
    repository.checkpoint(SESSION, "r1", { progress: { elapsedMs: 5, currentVirtualUsers: 1, requestsSoFar: 2, failuresSoFar: 0, journeysCutShortSoFar: 0, tokenRefreshesSoFar: 0, steps: [] } });
    expect(repository.requestChainCancel(SESSION, "r1").cancelRequested).toBe(true);
    expect(repository.isCancelRequested(SESSION, "r1")).toBe(true);
    const settled = repository.settle(SESSION, "r1", { status: "failed", failure: { category: "setup-step-failed" } }, "2026-10-03T10:01:00.000Z");
    expect(settled.status).toBe("failed");
    const run = repository.getChainRun(SESSION, "r1");
    expect(run?.failure).toEqual({ category: "setup-step-failed" });
    expect(run?.progress?.requestsSoFar).toBe(2);
    expect(run?.endedAt).toBe("2026-10-03T10:01:00.000Z");
  });

  it("marks an interrupted chain run cancelled at startup, like any other", () => {
    const repository = getPerformanceRunRepository();
    repository.createChainRun(SESSION, chainRun("r1"), PLAN_DOCUMENT);
    expect(repository.markInterruptedRunsCancelled()).toBe(1);
    expect(repository.getChainRun(SESSION, "r1")?.cancelReason).toBe("backend-restart");
  });
});
