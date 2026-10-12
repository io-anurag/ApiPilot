import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainRun, SeedSource } from "@apipilot/shared-domain";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { startPerformanceRun } from "../../../src/performance/runPerformanceTest";
import { readLiveSnapshot } from "../../../src/performance/live/liveRunRegistry";
import type { FailureResponseSettings } from "../../../src/performance/live/failureSamples";
import { sha256Hex } from "../../../src/performance/plan/identifiers";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";

/** specs/048-workflow-run-stage-status T020: the settle point of `startPerformanceRun` tells the guided workflow. */

const completePerformanceForRun = vi.hoisted(() => vi.fn());
const getCurrentWorkflow = vi.hoisted(() => vi.fn());

vi.mock("../../../src/testGenerationWorkflow/runCompletion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/testGenerationWorkflow/runCompletion")>();
  completePerformanceForRun.mockImplementation(actual.completePerformanceForRun);
  return { ...actual, completePerformanceForRun };
});
vi.mock("../../../src/testGenerationWorkflow/workflowStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/testGenerationWorkflow/workflowStore")>();
  getCurrentWorkflow.mockImplementation(actual.getCurrentWorkflow);
  return { ...actual, getCurrentWorkflow };
});

const SESSION = "33333333-3333-4333-8333-333333333333";
const SCRIPT = "// generated script";

function chainRun(id: string, seedSource: SeedSource | null): ChainRun {
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
      seedSource,
      contentNotice: "user-authored-unverified",
    },
    scriptSha256: sha256Hex(SCRIPT),
    k6Version: "1.2.0",
    plannedDurationMs: 60000,
    startedAt: "2026-10-12T10:00:00.000Z",
    cancelRequested: false,
  };
}

describe("startPerformanceRun settle point (specs/048)", () => {
  let runDirectoryRoot: string;

  beforeEach(() => {
    runDirectoryRoot = mkdtempSync(path.join(os.tmpdir(), "apipilot-run-"));
    completePerformanceForRun.mockClear();
    getCurrentWorkflow.mockClear();
  });

  afterEach(() => {
    rmSync(runDirectoryRoot, { recursive: true, force: true });
  });

  async function run(id: string, seedSource: SeedSource | null) {
    const chain = chainRun(id, seedSource);
    getPerformanceRunRepository().createChainRun(SESSION, chain, "{}");
    await startPerformanceRun({
      sessionId: SESSION,
      run: chain,
      script: {
        planFingerprint: "f1",
        scriptSha256: sha256Hex(SCRIPT),
        environmentTemplateSha256: "t",
        script: SCRIPT,
        environmentTemplate: "{}",
        stepCount: 0,
        valueIndex: {},
      },
      environment: { id: "e1", name: "Local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: {}, requestDelayMs: 0 },
      binaryPath: "k6",
      runner: createFakeRunner({ lines: [] }),
      tickIntervalMs: 1000,
      now: () => new Date("2026-10-12T10:00:01.000Z"),
      runDirectoryRoot,
    });
    return getPerformanceRunRepository().getChainRun(SESSION, id);
  }

  it("calls the applier once with the final status and the run's seed source", async () => {
    const seed: SeedSource = { kind: "workflow", specificationTitle: "Orders API" };
    const settled = await run("r-seeded", seed);
    expect(settled?.status).toBe("completed");
    expect(completePerformanceForRun).toHaveBeenCalledTimes(1);
    expect(completePerformanceForRun).toHaveBeenCalledWith(SESSION, "completed", seed);
  });

  it("passes a null seed for a run with no recorded seed source", async () => {
    await run("r-unseeded", null);
    expect(completePerformanceForRun).toHaveBeenCalledWith(SESSION, "completed", null);
  });

  it("does not change the run's settled status when updating the stage fails", async () => {
    getCurrentWorkflow.mockImplementationOnce(() => {
      throw new Error("store unavailable");
    });
    const settled = await run("r-failing-apply", { kind: "workflow", specificationTitle: "Orders API" });
    expect(settled?.status).toBe("completed");
    expect(completePerformanceForRun).toHaveBeenCalledTimes(1);
  });
});

describe("startPerformanceRun failed-response samples (AP-049)", () => {
  let runDirectoryRoot: string;

  beforeEach(() => {
    runDirectoryRoot = mkdtempSync(path.join(os.tmpdir(), "apipilot-run-"));
  });

  afterEach(() => {
    rmSync(runDirectoryRoot, { recursive: true, force: true });
  });

  const failureLine = (body: string, status = 400) =>
    JSON.stringify({ level: "info", msg: `APIPILOT_FAILURE ${JSON.stringify({ step: "s2", journey: "c1", status, type: "application/json", size: body.length, body })}`, source: "console" });

  async function runWith(id: string, stderrLines: string[], failureResponses?: FailureResponseSettings) {
    const chain = chainRun(id, null);
    getPerformanceRunRepository().createChainRun(SESSION, chain, "{}");
    await startPerformanceRun({
      sessionId: SESSION,
      run: chain,
      script: { planFingerprint: "f1", scriptSha256: sha256Hex(SCRIPT), environmentTemplateSha256: "t", script: SCRIPT, environmentTemplate: "{}", stepCount: 0, valueIndex: {} },
      environment: { id: "e1", name: "Local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: {}, requestDelayMs: 0 },
      binaryPath: "k6",
      runner: createFakeRunner({ lines: [], stderrLines }),
      tickIntervalMs: 1000,
      now: () => new Date("2026-10-12T10:00:05.500Z"),
      runDirectoryRoot,
      ...(failureResponses ? { failureResponses } : {}),
    });
    return readLiveSnapshot(SESSION, id, Date.parse("2026-10-12T10:00:06.000Z"), { since: 0 });
  }

  it("shows a sampled failure's masked response on the live snapshot", async () => {
    const snapshot = await runWith("r-failure-live", [failureLine('{"error":"duplicate","echo":"hunter2-secret"}'), "not a sample line"], { secrets: [{ name: "api_secret", value: "hunter2-secret", kind: "environment" }], withhold: false });
    expect(snapshot?.recentFailures).toHaveLength(1);
    const [failure] = snapshot!.recentFailures!;
    expect(failure).toMatchObject({ second: 5, status: 400 });
    expect(failure.response).toMatchObject({ kind: "text", contentType: "application/json" });
    expect(JSON.stringify(failure)).not.toContain("hunter2-secret");
    expect(JSON.stringify(failure)).toContain("duplicate");
  });

  it("is empty when nothing failed, and never reaches the stored result", async () => {
    const snapshot = await runWith("r-no-failure", []);
    expect(snapshot?.recentFailures).toEqual([]);
    const stored = getPerformanceRunRepository().getChainRun(SESSION, "r-no-failure");
    expect(JSON.stringify(stored)).not.toContain("recentFailures");
  });

  it("keeps the response out of the stored run", async () => {
    await runWith("r-failure-stored", [failureLine("uniquebodymarker")]);
    expect(JSON.stringify(getPerformanceRunRepository().getChainRun(SESSION, "r-failure-stored"))).not.toContain("uniquebodymarker");
  });
});
