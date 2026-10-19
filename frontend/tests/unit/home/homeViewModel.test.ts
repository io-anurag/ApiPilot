import { describe, expect, it } from "vitest";
import type { ChainRunSummary, StageStatus, TestGenerationWorkflow, UserScriptRunSummary, WorkflowStageId } from "@apipilot/shared-domain";
import { WORKFLOW_STAGE_ORDER } from "@apipilot/shared-domain";
import {
  aiStatusText,
  importRuns,
  k6Runs,
  mergeRecentRuns,
  nextSteps,
  performanceRuns,
  summaryFigures,
  type RecentRun,
} from "../../../src/components/home/homeViewModel";
import { coverageEntryState } from "../../../src/components/apiCoverage/coverageViewModel";
import { gap, metric, snapshot } from "../apiCoverage/coverageFixtures";

const NO_PROBLEM = null;

function figure(figures: ReturnType<typeof summaryFigures>, id: string) {
  const found = figures.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no figure ${id}`);
  return found;
}

describe("summaryFigures (AP-054 FR-019, SC-006)", () => {
  it("reads every figure from the snapshot", () => {
    const figures = summaryFigures({ snapshot: snapshot({ gaps: [gap({ id: "g1", operationKey: "GET /a", priority: "high" }), gap({ id: "g2", operationKey: "GET /b", priority: "low" })] }), problem: NO_PROBLEM });
    expect(figure(figures, "spec-coverage")).toMatchObject({ state: "ready", value: "100%", sub: "4 of 4 operations" });
    expect(figure(figures, "runtime-verified")).toMatchObject({ state: "ready", value: "75%", sub: "3 of 4 operations" });
    expect(figure(figures, "open-gaps")).toMatchObject({ state: "ready", value: "1" });
    expect(figure(figures, "pending-scenarios")).toMatchObject({ state: "ready", value: "3", sub: "3 of 30 scenarios" });
  });

  it("fills each bar with the share its own counts give, never a made-up ratio", () => {
    const figures = summaryFigures({ snapshot: snapshot({ gaps: [gap({ id: "g1", operationKey: "GET /a", priority: "high" }), gap({ id: "g2", operationKey: "GET /b", priority: "low" })] }), problem: NO_PROBLEM });
    expect(figure(figures, "spec-coverage")).toMatchObject({ ratio: 1 });
    expect(figure(figures, "runtime-verified")).toMatchObject({ ratio: 0.75 });
    expect(figure(figures, "pending-scenarios")).toMatchObject({ ratio: 0.1 });
    const gaps = figure(figures, "open-gaps");
    if (gaps.state !== "ready") throw new Error("expected a ready figure");
    expect(gaps.ratio).toBeGreaterThanOrEqual(0);
    expect(gaps.ratio).toBeLessThanOrEqual(1);
  });

  it("equals the figures the Coverage screen's entry state reads from the same snapshot", () => {
    const shared = snapshot();
    const entry = coverageEntryState(shared, null);
    const figures = summaryFigures({ snapshot: shared, problem: NO_PROBLEM });
    if (entry.status !== "ready") throw new Error("expected a ready entry state");
    expect(figure(figures, "spec-coverage")).toMatchObject({ value: `${entry.specOperations?.percentage}%` });
    expect(figure(figures, "runtime-verified")).toMatchObject({ value: `${entry.runtimeOperations?.percentage}%` });
    expect(figure(figures, "open-gaps")).toMatchObject({ value: String(entry.highPriorityGaps) });
  });

  it("shows a reason and no number with no specification", () => {
    const figures = summaryFigures({ snapshot: null, problem: { kind: "no-workflow", message: "none" } });
    for (const item of figures) {
      expect(item).toMatchObject({ state: "unavailable", reason: "Needs a specification from the Guided Workflow." });
      expect("value" in item).toBe(false);
    }
  });

  it("names a failure rather than showing zero, and says loading while it loads", () => {
    expect(figure(summaryFigures({ snapshot: null, problem: { kind: "error", message: "boom" } }), "open-gaps")).toMatchObject({ reason: "Coverage is unavailable: boom" });
    expect(figure(summaryFigures({ snapshot: null, problem: null }), "open-gaps")).toMatchObject({ reason: "Loading coverage…" });
  });

  it("says no run yet, not 0%, when no run supplied evidence", () => {
    const base = snapshot();
    const figures = summaryFigures({ snapshot: { ...base, execution: { ...base.execution, runIds: [] } }, problem: NO_PROBLEM });
    expect(figure(figures, "runtime-verified")).toMatchObject({ state: "unavailable", reason: "No run yet" });
  });

  it("says not available when nothing is eligible, never 0%", () => {
    const empty = snapshot({ metrics: [metric("spec-operations", "specification", "Operations", 0, 0), metric("runtime-operations", "runtime", "Operations", 0, 0)] });
    expect(figure(summaryFigures({ snapshot: empty, problem: NO_PROBLEM }), "spec-coverage")).toMatchObject({ value: "not available" });
  });
});

function workflowAt(active: WorkflowStageId, statuses: Partial<Record<WorkflowStageId, StageStatus>> = {}): TestGenerationWorkflow {
  const index = WORKFLOW_STAGE_ORDER.indexOf(active);
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((id, i) => [id, { status: statuses[id] ?? (i < index ? "complete" : i === index ? "active" : "not-yet-reached") }]),
  );
  return { id: "wf-1", activeStageId: active, stages } as unknown as TestGenerationWorkflow;
}

describe("nextSteps (AP-054 FR-021)", () => {
  it("says nothing is waiting when nothing is", () => {
    expect(nextSteps({ workflow: null, snapshot: null, performanceDraft: false })).toEqual([]);
  });

  it("lists the unfinished guided workflow first, then the coverage steps, then the performance draft, each with a route", () => {
    const withWork = snapshot({
      operationCounts: { eligible: 4, withScenarios: 3, withPassingVerification: 2, withFailures: 1, withNoScenarios: 2 },
      assertionOutcomes: { passed: 0, failed: 0, notEvaluated: 0 },
    });
    const steps = nextSteps({ workflow: workflowAt("scenarioReview"), snapshot: withWork, performanceDraft: true });
    expect(steps.map((step) => step.id)).toEqual(["continue-guided", "review-pending", "cover-operations", "investigate-failures", "finish-performance-draft"]);
    expect(steps[0]).toMatchObject({ title: "Continue Scenario Review", route: { view: "guided", stage: "scenarioReview" } });
    expect(steps[1]).toMatchObject({ title: "Review 3 pending scenarios", route: { view: "guided", stage: "scenarioReview" } });
    expect(steps[2]).toMatchObject({ title: "Cover 2 operations with no generated tests", route: { view: "coverage" } });
    expect(steps[3]).toMatchObject({ title: "Investigate 1 failing result", route: { view: "coverage" } });
    expect(steps[4]).toMatchObject({ title: "Finish the draft load test", route: { view: "performance" } });
  });

  it("does not call a finished guided workflow unfinished, nor an optional last stage", () => {
    const finished = workflowAt("performanceTesting", { performanceTesting: "active" });
    expect(nextSteps({ workflow: finished, snapshot: null, performanceDraft: false })).toEqual([]);
  });

  it("omits steps whose count is zero", () => {
    const quiet = snapshot({
      context: { ...snapshot().context, scenarioCounts: { total: 3, accepted: 3, pending: 0, rejected: 0, rule: 3, ai: 0 } },
      operationCounts: { eligible: 4, withScenarios: 4, withPassingVerification: 4, withFailures: 0, withNoScenarios: 0 },
      assertionOutcomes: { passed: 5, failed: 0, notEvaluated: 0 },
    });
    expect(nextSteps({ workflow: null, snapshot: quiet, performanceDraft: false })).toEqual([]);
  });
});

function run(workflow: RecentRun["workflow"], id: string, startedAt: string): RecentRun {
  return { key: `${workflow}:${id}`, workflow, subject: id, startedAt, status: "completed", target: { workflow, ownerId: "o", runId: id } };
}

describe("recent runs (AP-054 FR-020)", () => {
  it("merges newest first and keeps at most eight", () => {
    const rows = Array.from({ length: 12 }, (_, i) => run(i % 2 ? "import" : "k6", `r${i}`, `2026-10-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`));
    const merged = mergeRecentRuns(rows);
    expect(merged).toHaveLength(8);
    expect(merged[0].key).toBe("import:r11");
    expect(merged.at(-1)?.key).toBe("k6:r4");
  });

  it("keeps source order for runs that started at the same moment", () => {
    const at = "2026-10-10T10:00:00.000Z";
    expect(mergeRecentRuns([run("import", "a", at), run("k6", "b", at)]).map((r) => r.key)).toEqual(["import:a", "k6:b"]);
  });

  it("maps each source to its subject, status and deep-link target", () => {
    const imported = importRuns("Orders", [{ id: "r1", uploadedCollectionSetId: "c1", uploadedCollectionSnapshot: { name: "Orders", tier: "local" }, status: "cancelled", startedAt: "2026-10-10T10:00:00.000Z" } as never]);
    expect(imported[0]).toMatchObject({ subject: "Orders", status: "cancelled", target: { workflow: "import", ownerId: "c1", runId: "r1" } });
    const perf = performanceRuns("p1", "Smoke plan", [{ id: "r2", status: "failed", startedAt: "2026-10-10T11:00:00.000Z" } as ChainRunSummary]);
    expect(perf[0]).toMatchObject({ subject: "Smoke plan", status: "failed", target: { workflow: "performance", ownerId: "p1", runId: "r2" } });
    const k6 = k6Runs([{ id: "r3", status: "in-progress", startedAt: "2026-10-10T12:00:00.000Z", snapshot: { scriptId: "s1", scriptName: "orders.js" } } as UserScriptRunSummary]);
    expect(k6[0]).toMatchObject({ subject: "orders.js", status: "in-progress", target: { workflow: "k6", ownerId: "s1", runId: "r3" } });
  });
});

describe("aiStatusText", () => {
  it("shows state and provider in words, and the reason only when unavailable", () => {
    expect(aiStatusText({ state: "ready", provider: "mock", reason: null })).toEqual({ state: "Ready", provider: "Mock provider", reason: null });
    expect(aiStatusText({ state: "unavailable", provider: "local", reason: "Model files are missing." })).toEqual({
      state: "Unavailable",
      provider: "Local model",
      reason: "Model files are missing.",
    });
    expect(aiStatusText({ state: "loading", provider: "local", reason: "ignored" }).reason).toBeNull();
  });
});
