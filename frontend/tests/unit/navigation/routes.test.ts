import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import {
  DESTINATION_IDS,
  SECURITY_AREAS,
  formatRoute,
  parseRoute,
  resolveRoute,
  type Route,
} from "../../../src/navigation/routes";

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
  return { id: "wf-test", activeStageId: active, stages } as unknown as TestGenerationWorkflow;
}

const ALL_ROUTES: Route[] = [
  ...DESTINATION_IDS.map((view) => ({ view }) as Route),
  ...WORKFLOW_STAGE_ORDER.map((stage) => ({ view: "guided", stage }) as Route),
  ...SECURITY_AREAS.map((area) => ({ view: "security", area }) as Route),
];

describe("parseRoute and formatRoute (AP-054 FR-029)", () => {
  it.each(ALL_ROUTES.map((route) => [formatRoute(route), route] as const))("round-trips %s", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
    expect(formatRoute(parseRoute(hash) as Route)).toBe(hash);
  });

  it("treats an empty hash as Home", () => {
    expect(parseRoute("")).toEqual({ view: "home" });
    expect(parseRoute("#")).toEqual({ view: "home" });
    expect(parseRoute("#/")).toEqual({ view: "home" });
  });

  it.each([
    "#/nonsense",
    "#/Guided",
    "#/GUIDED/upload",
    "#/guided/unknownStage",
    "#/guided/Upload",
    "#/guided/upload/extra",
    "#/import/upload",
    "#/performance/",
    "#/k6/x",
    "#guided",
    "#/guided//",
    "#/coverage?x=1",
    "#/security/Overview",
    "#/security/unknown",
    "#/security/scenarios/extra",
    "#/security/",
    "#/coverage/overview",
    "/guided",
  ])("rejects %s", (hash) => {
    expect(parseRoute(hash)).toBeNull();
  });

  it("never puts a query, an assignment, a file extension or a space in an address", () => {
    for (const route of ALL_ROUTES) {
      const hash = formatRoute(route);
      expect(hash).not.toMatch(/[?= ]/);
      expect(hash).not.toMatch(/\.[a-z0-9]+$/i);
    }
  });
});

describe("resolveRoute (AP-054 FR-029)", () => {
  const none = { workflow: null };

  it("shows Home with a notice for an address that does not parse", () => {
    const result = resolveRoute(null, none);
    expect(result.route).toEqual({ view: "home" });
    expect(result.notice).toMatch(/does not match a screen/);
    expect(result.replace).toBe(true);
  });

  it("opens the Guided Workflow at Upload when a stage is requested with no workflow", () => {
    const result = resolveRoute({ view: "guided", stage: "scenarioReview" }, none);
    expect(result.route).toEqual({ view: "guided" });
    expect(result.notice).toMatch(/no workflow in progress/);
    expect(result.replace).toBe(true);
  });

  it("redirects a locked stage to the active stage and says why", () => {
    const result = resolveRoute({ view: "guided", stage: "scenarioReview" }, { workflow: workflowAt("apiReview") });
    expect(result.route).toEqual({ view: "guided", stage: "apiReview" });
    // The nearest predecessor that is not complete (the lock reason of the stage view model).
    expect(result.notice).toBe("Complete AI Enhancement first.");
    expect(result.replace).toBe(true);
  });

  it.each<[StageStatus, WorkflowStageId]>([
    ["complete", "upload"],
    ["active", "apiReview"],
    ["stale", "analysis"],
    ["skipped", "aiEnhancement"],
    ["partial", "aiEnhancement"],
  ])("shows a %s stage as asked", (status, stage) => {
    const workflow = workflowAt("apiReview", { [stage]: status });
    const requested: Route = { view: "guided", stage };
    expect(resolveRoute(requested, { workflow })).toEqual({ route: requested, notice: null, replace: false });
  });

  it.each(DESTINATION_IDS.map((view) => ({ view }) as Route))("shows $view as asked", (route) => {
    expect(resolveRoute(route, none)).toEqual({ route, notice: null, replace: false });
  });

  it("is total: it never throws for any route, with or without a workflow", () => {
    for (const route of [...ALL_ROUTES, null]) {
      expect(() => resolveRoute(route, none)).not.toThrow();
      expect(() => resolveRoute(route, { workflow: workflowAt("upload") })).not.toThrow();
    }
  });
});

describe("Security Lab address (AP-057 FR-003, research R18)", () => {
  it("accepts the bare destination and exactly the four areas", () => {
    expect(parseRoute("#/security")).toEqual({ view: "security" });
    expect(SECURITY_AREAS).toEqual(["overview", "scenarios", "execution", "reports"]);
    for (const area of SECURITY_AREAS) expect(parseRoute(`#/security/${area}`)).toEqual({ view: "security", area });
  });

  it("formats an area-less route as the bare destination and an area route with its area", () => {
    expect(formatRoute({ view: "security" })).toBe("#/security");
    expect(formatRoute({ view: "security", area: "reports" })).toBe("#/security/reports");
  });

  it("does not let an area appear on any other destination", () => {
    expect(parseRoute("#/import/overview")).toBeNull();
    expect(parseRoute("#/performance/scenarios")).toBeNull();
  });

  it("shows a security route as asked, with or without a workflow", () => {
    for (const requested of [{ view: "security" }, { view: "security", area: "scenarios" }] as Route[]) {
      expect(resolveRoute(requested, { workflow: null })).toEqual({ route: requested, notice: null, replace: false });
      expect(resolveRoute(requested, { workflow: workflowAt("upload") })).toEqual({ route: requested, notice: null, replace: false });
    }
  });

  it("falls back to Home with a notice for an unknown area, because parseRoute returns null for it", () => {
    const resolved = resolveRoute(parseRoute("#/security/nope"), { workflow: null });
    expect(resolved.route).toEqual({ view: "home" });
    expect(resolved.notice).toMatch(/does not match a screen/);
    expect(resolved.replace).toBe(true);
  });
});
