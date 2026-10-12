import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainRun, SeedSource } from "@apipilot/shared-domain";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { startPerformanceRun } from "../../../src/performance/runPerformanceTest";
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
