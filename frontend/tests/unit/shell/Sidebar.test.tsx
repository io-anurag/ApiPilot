import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import { Sidebar } from "../../../src/components/shell/Sidebar";
import type { Route } from "../../../src/navigation/routes";

function workflowAt(active: WorkflowStageId, overrides: Partial<Record<WorkflowStageId, StageStatus>> = {}): TestGenerationWorkflow {
  const activeIndex = WORKFLOW_STAGE_ORDER.indexOf(active);
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((id, index) => {
      let status: StageStatus = "not-yet-reached";
      if (index < activeIndex) status = "complete";
      else if (index === activeIndex) status = "active";
      return [id, { status: overrides[id] ?? status }];
    }),
  );
  return { id: "wf-1", activeStageId: active, stages } as unknown as TestGenerationWorkflow;
}

function renderSidebar(route: Route, workflow: TestGenerationWorkflow | null = null, onNavigate = vi.fn()) {
  render(<Sidebar route={route} workflow={workflow} viewedStage={null} onNavigate={onNavigate} />);
  return { nav: within(screen.getByRole("navigation", { name: "Primary" })), onNavigate };
}

describe("Sidebar (AP-054 FR-002, FR-003)", () => {
  it("lists the six destinations as links named by the workflow titles, and nothing else", () => {
    const { nav } = renderSidebar({ view: "home" });
    expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home",
      "Guided Workflow",
      "Import & Run Collection",
      "Performance",
      "Run k6 Script",
      "Coverage",
    ]);
    expect(nav.getByText("ApiPilot")).toBeInTheDocument();
  });

  it.each([
    [{ view: "home" }, "Home"],
    [{ view: "guided" }, "Guided Workflow"],
    [{ view: "import" }, "Import & Run Collection"],
    [{ view: "performance" }, "Performance"],
    [{ view: "k6" }, "Run k6 Script"],
    [{ view: "coverage" }, "Coverage"],
  ] as const)("marks %o as the current page, and only that one", (route, name) => {
    const { nav } = renderSidebar(route as Route);
    expect(nav.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual([name]);
  });

  it("navigates with a plain click and leaves a modified click to the browser", () => {
    const { nav, onNavigate } = renderSidebar({ view: "home" });
    const link = nav.getByRole("link", { name: "Performance" });
    expect(link).toHaveAttribute("href", "#/performance");
    expect(fireEvent.click(link)).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith({ view: "performance" });

    onNavigate.mockClear();
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows the eleven stages under Guided Workflow, grouped, behind a disclosure", () => {
    const { nav } = renderSidebar({ view: "home" }, workflowAt("apiReview"));
    const toggle = nav.getByRole("button", { name: "Show Guided Workflow stages" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(nav.queryByTestId("sidebar-stage-upload")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(nav.getByRole("button", { name: "Hide Guided Workflow stages" })).toHaveAttribute("aria-expanded", "true");
    expect(nav.getAllByTestId(/^sidebar-stage-/)).toHaveLength(11);
    expect(nav.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Prepare", "Design", "Organize", "Execute"]);
  });

  it("opens the stage list on its own when the Guided Workflow is the current page", () => {
    const { nav } = renderSidebar({ view: "guided", stage: "apiReview" }, workflowAt("apiReview"));
    expect(nav.getByRole("button", { name: "Hide Guided Workflow stages" })).toHaveAttribute("aria-expanded", "true");
    expect(nav.getByTestId("sidebar-stage-apiReview")).toHaveAttribute("aria-current", "step");
  });

  it("makes a done stage a link, and a locked stage a disabled control that says why", () => {
    const { nav, onNavigate } = renderSidebar({ view: "guided", stage: "apiReview" }, workflowAt("apiReview"));
    const done = nav.getByTestId("sidebar-stage-upload");
    expect(done.tagName).toBe("A");
    expect(done).toHaveAttribute("href", "#/guided/upload");
    expect(within(done).getByRole("img", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(done);
    expect(onNavigate).toHaveBeenCalledWith({ view: "guided", stage: "upload" });

    const locked = nav.getByTestId("sidebar-stage-scenarioReview");
    expect(locked.tagName).toBe("BUTTON");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(within(locked).getByRole("img", { name: "Locked" })).toBeInTheDocument();
    expect(locked).toHaveAccessibleDescription(/^Complete .* first$/);
    onNavigate.mockClear();
    fireEvent.click(locked);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("says a stale stage needs redoing in words", () => {
    const { nav } = renderSidebar({ view: "guided", stage: "apiReview" }, workflowAt("apiReview", { analysis: "stale" }));
    expect(within(nav.getByTestId("sidebar-stage-analysis")).getByText("Redo")).toBeInTheDocument();
  });

  it("with no workflow, only Upload can be opened", () => {
    const { nav } = renderSidebar({ view: "guided" }, null);
    const stages = nav.getAllByTestId(/^sidebar-stage-/);
    expect(stages.filter((s) => s.tagName === "A").map((s) => s.getAttribute("data-testid"))).toEqual(["sidebar-stage-upload"]);
    expect(nav.getByTestId("sidebar-stage-upload")).toHaveAttribute("aria-current", "step");
  });
});
