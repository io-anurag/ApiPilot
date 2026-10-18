import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import {
  TOP_DESTINATIONS,
  buildStageGroups,
  destinationOfView,
  viewOfDestination,
  guidedStageOf,
  headerTitleFor,
  titleOfDestination,
} from "../../../src/navigation/destinations";
import { STAGE_LABELS, WORKFLOW_PHASES } from "../../../src/components/workflowStageViewModel";

function workflowWith(statuses: Partial<Record<WorkflowStageId, StageStatus>>, active: WorkflowStageId): TestGenerationWorkflow {
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((id) => [id, { status: statuses[id] ?? "not-yet-reached" }]),
  );
  return { id: "wf-1", activeStageId: active, stages } as unknown as TestGenerationWorkflow;
}

describe("sidebar destinations (AP-054)", () => {
  it("names each workflow by its full title and lists the destinations in order", () => {
    expect(TOP_DESTINATIONS.map((d) => [d.id, d.label])).toEqual([
      ["import", "Import & Run Collection"],
      ["performance", "Performance"],
      ["k6", "Run k6 Script"],
      ["coverage", "Coverage"],
      ["security", "Security Lab"],
    ]);
    expect(titleOfDestination("guided")).toBe("Guided Workflow");
    expect(titleOfDestination("home")).toBe("Home");
  });
});

describe("buildStageGroups (AP-054 FR-003)", () => {
  it("groups the eleven stages exactly as the stage model does", () => {
    const groups = buildStageGroups(null, null);
    expect(groups.map((g) => [g.label, g.stages.length])).toEqual([
      ["Prepare", 3],
      ["Design", 3],
      ["Organize", 2],
      ["Execute", 3],
    ]);
    expect(groups.map((g) => g.stages.map((s) => s.id))).toEqual(WORKFLOW_PHASES.map((p) => [...p.stages]));
    expect(groups.flatMap((g) => g.stages).map((s) => s.label)).toEqual(WORKFLOW_STAGE_ORDER.map((id) => STAGE_LABELS[id]));
  });

  it("offers only Upload when there is no workflow, and says why the rest are locked", () => {
    const stages = buildStageGroups(null, null).flatMap((g) => g.stages);
    expect(stages.filter((s) => s.state === "available").map((s) => s.id)).toEqual(["upload"]);
    for (const stage of stages.filter((s) => s.id !== "upload")) {
      expect(stage.state).toBe("locked");
      expect(stage.lockReason).toBe("Upload a specification first");
    }
  });

  it("maps statuses to done, needs-redo, available and locked with the stage-model lock reason", () => {
    const workflow = workflowWith(
      { upload: "complete", analysis: "complete", apiReview: "active", aiEnhancement: "skipped" },
      "apiReview",
    );
    const byId = Object.fromEntries(buildStageGroups(workflow, "apiReview").flatMap((g) => g.stages).map((s) => [s.id, s]));
    expect(byId.upload.state).toBe("done");
    expect(byId.apiReview.state).toBe("available");
    expect(byId.aiEnhancement.state).toBe("done");
    expect(byId.scenarioReview.state).toBe("locked");
    expect(byId.scenarioReview.lockReason).toMatch(/^Complete .* first$/);
    expect(byId.upload.lockReason).toBeNull();

    const stale = workflowWith({ upload: "complete", analysis: "stale" }, "analysis");
    expect(buildStageGroups(stale, null).flatMap((g) => g.stages).find((s) => s.id === "analysis")?.state).toBe("stale");
  });

  it("marks exactly one stage as current, or none outside the Guided Workflow", () => {
    const workflow = workflowWith({ upload: "complete", analysis: "active" }, "analysis");
    expect(buildStageGroups(workflow, "analysis").flatMap((g) => g.stages).filter((s) => s.current).map((s) => s.id)).toEqual(["analysis"]);
    expect(buildStageGroups(workflow, null).flatMap((g) => g.stages).some((s) => s.current)).toBe(false);
  });

  it("flags Performance Testing as optional", () => {
    const stages = buildStageGroups(null, null).flatMap((g) => g.stages);
    expect(stages.filter((s) => s.optional).map((s) => s.id)).toEqual(["performanceTesting"]);
  });
});

describe("headerTitleFor (AP-054 FR-004)", () => {
  it("names each destination and its parent", () => {
    expect(headerTitleFor({ view: "home" }, null)).toEqual({ title: "Home", parent: "Workspace" });
    expect(headerTitleFor({ view: "coverage" }, null)).toEqual({ title: "Coverage", parent: "Results" });
    expect(headerTitleFor({ view: "import" }, null)).toEqual({ title: "Import & Run Collection", parent: "Workflows" });
    expect(headerTitleFor({ view: "guided", stage: "scenarioReview" }, null)).toEqual({
      title: "Scenario Review",
      parent: "Guided Workflow › Design",
    });
    expect(headerTitleFor({ view: "guided" }, "apiReview")).toEqual({
      title: "API Review",
      parent: "Guided Workflow › Prepare",
    });
    expect(headerTitleFor({ view: "guided" }, null)).toEqual({ title: "Guided Workflow", parent: "Workflows" });
  });

  it("resolves the stage the Guided Workflow shows", () => {
    const workflow = workflowWith({ upload: "complete", analysis: "active" }, "analysis");
    expect(guidedStageOf({ view: "guided", stage: "upload" }, workflow)).toBe("upload");
    expect(guidedStageOf({ view: "guided" }, workflow)).toBe("analysis");
    expect(guidedStageOf({ view: "guided" }, null)).toBe("upload");
  });
});

describe("Security Lab destination (AP-057 FR-001)", () => {
  it("is placed directly after Coverage, beside Import & Run Collection, and titled Security Lab", () => {
    const ids = TOP_DESTINATIONS.map((d) => d.id);
    expect(ids.indexOf("security")).toBe(ids.indexOf("coverage") + 1);
    expect(titleOfDestination("security")).toBe("Security Lab");
  });

  it("heads the page like the other results view, with or without an area", () => {
    expect(headerTitleFor({ view: "security" }, null)).toEqual({ title: "Security Lab", parent: "Results" });
    expect(headerTitleFor({ view: "security", area: "reports" }, null)).toEqual({ title: "Security Lab", parent: "Results" });
  });

  it("maps between the catalog view and the destination in both directions", () => {
    expect(destinationOfView("security")).toBe("security");
    expect(viewOfDestination("security")).toBe("security");
    expect(destinationOfView("coverage")).toBe("coverage");
  });
});
