import { describe, expect, it } from "vitest";
import {
  entryStep,
  hasDraft,
  INITIAL_PATH_STATE,
  isPathVisible,
  isStepSelectable,
  isStepSkipped,
  nextAvailability,
  nextStep,
  pathReducer,
  previousStep,
  stepLabel,
  type GateContext,
  type PathState,
} from "../../src/components/performance/path/pathState";

const gate = (overrides: Partial<GateContext> = {}): GateContext => ({
  source: "specification",
  specificationReady: true,
  selectionCount: 3,
  workflowReady: null,
  planExists: false,
  planName: "Petstore plan",
  planStepCount: 2,
  loadProblem: null,
  ...overrides,
});

describe("entryStep (FR-007)", () => {
  it("opens a specification on Operations when one is already uploaded and on Source when not", () => {
    expect(entryStep("specification", true)).toBe("operations");
    expect(entryStep("specification", false)).toBe("source");
  });
  it("opens a workflow and a collection on Operations and an empty plan on Plan", () => {
    expect(entryStep("workflow", false)).toBe("operations");
    expect(entryStep("collection", false)).toBe("operations");
    expect(entryStep("empty", false)).toBe("plan");
  });
});

describe("step labels, skipping and selection (FR-006, FR-008)", () => {
  it("names the Operations step for what the source contains", () => {
    expect(stepLabel("operations", "specification")).toBe("Operations");
    expect(stepLabel("operations", "workflow")).toBe("Workflows");
    expect(stepLabel("operations", "collection")).toBe("Requests");
    expect(stepLabel("run", null)).toBe("Run");
  });
  it("skips Operations only for an empty plan, in both directions", () => {
    expect(isStepSkipped("operations", "empty")).toBe(true);
    expect(isStepSkipped("operations", "specification")).toBe(false);
    expect(nextStep("source", "empty")).toBe("plan");
    expect(previousStep("plan", "empty")).toBe("source");
    expect(nextStep("source", "specification")).toBe("operations");
    expect(nextStep("run", "specification")).toBeNull();
    expect(previousStep("source", "specification")).toBeNull();
  });
  it("lets a reached step be selected but never a later one or a skipped one", () => {
    expect(isStepSelectable("source", 1, "specification")).toBe(true);
    expect(isStepSelectable("operations", 1, "specification")).toBe(true);
    expect(isStepSelectable("plan", 1, "specification")).toBe(false);
    expect(isStepSelectable("operations", 4, "empty")).toBe(false);
  });
});

describe("nextAvailability (FR-009)", () => {
  it("Source needs a source, and for a specification an analysed upload", () => {
    expect(nextAvailability("source", gate({ source: null }))).toEqual({ available: false, reason: "Choose a source" });
    expect(nextAvailability("source", gate({ specificationReady: false })).reason).toBe("Upload the specification to continue");
    expect(nextAvailability("source", gate()).available).toBe(true);
    expect(nextAvailability("source", gate({ source: "workflow", specificationReady: false })).available).toBe(true);
  });
  it("Operations needs a selection, except a workflow which has none but must be ready", () => {
    expect(nextAvailability("operations", gate({ selectionCount: 0 })).reason).toBe("Choose at least one operation");
    expect(nextAvailability("operations", gate({ source: "collection", selectionCount: 0 })).reason).toBe("Choose at least one request");
    expect(nextAvailability("operations", gate({ source: "workflow", selectionCount: 0, workflowReady: false })).available).toBe(false);
    expect(nextAvailability("operations", gate({ source: "workflow", selectionCount: 0, workflowReady: true })).available).toBe(true);
    // Until the guided workflow has been read it is not known to be ready.
    expect(nextAvailability("operations", gate({ source: "workflow", selectionCount: 0, workflowReady: null }))).toEqual({ available: false, reason: "Reading the guided workflow…" });
    expect(nextAvailability("operations", gate()).available).toBe(true);
  });
  it("Plan needs a name and at least one step", () => {
    expect(nextAvailability("plan", gate({ planName: "  " })).reason).toBe("Name the plan");
    expect(nextAvailability("plan", gate({ planStepCount: 0 })).reason).toBe("Add at least one step");
    expect(nextAvailability("plan", gate()).available).toBe(true);
  });
  it("Load needs a usable load profile, and Run has no Next", () => {
    expect(nextAvailability("load", gate({ loadProblem: "Fix the load profile first" })).reason).toBe("Fix the load profile first");
    expect(nextAvailability("load", gate()).available).toBe(true);
    expect(nextAvailability("run", gate())).toEqual({ available: false, reason: null });
  });
});

describe("pathReducer (data-model.md state transitions)", () => {
  const picked = (state: PathState = INITIAL_PATH_STATE) => pathReducer(state, { type: "pick", source: "specification", specificationLoaded: true, selection: ["a", "b"] });

  it("pick opens on the entry step with that step reached", () => {
    const state = picked();
    expect(state).toMatchObject({ source: "specification", step: "operations", reached: 1, planId: null, parked: false });
    expect(isPathVisible(state)).toBe(true);
    expect(hasDraft(state)).toBe(true);
    expect(pathReducer(INITIAL_PATH_STATE, { type: "pick", source: "specification", specificationLoaded: false, selection: [] })).toMatchObject({ step: "source", reached: 0 });
  });

  it("opening a plan lands on Plan with every step reached and no draft", () => {
    const state = pathReducer(INITIAL_PATH_STATE, { type: "open-plan", planId: "p1", source: "specification", selection: ["a"] });
    expect(state).toMatchObject({ step: "plan", reached: 4, planId: "p1" });
    expect(hasDraft(state)).toBe(false);
  });

  it("plan-created moves to Plan and keeps the selection", () => {
    const state = pathReducer(picked(), { type: "plan-created", planId: "p2" });
    expect(state).toMatchObject({ planId: "p2", step: "plan", selection: ["a", "b"], reached: 2 });
  });

  it("go ignores steps that are not selectable; next and back skip a skipped step", () => {
    const state = picked();
    expect(pathReducer(state, { type: "go", step: "run" })).toBe(state);
    expect(pathReducer(state, { type: "go", step: "source" }).step).toBe("source");
    const empty = pathReducer(INITIAL_PATH_STATE, { type: "pick", source: "empty", specificationLoaded: false, selection: [] });
    expect(empty.step).toBe("plan");
    expect(pathReducer(empty, { type: "back" }).step).toBe("source");
    expect(pathReducer(pathReducer(empty, { type: "back" }), { type: "next" }).step).toBe("plan");
  });

  it("Back keeps everything, and reached never goes down", () => {
    const atPlan = pathReducer(picked(), { type: "plan-created", planId: "p1" });
    const back = pathReducer(atPlan, { type: "back" });
    expect(back).toMatchObject({ step: "operations", reached: 2, selection: ["a", "b"] });
  });

  it("the source changes only while no plan exists (FR-014)", () => {
    expect(pathReducer(picked(), { type: "set-source", source: "collection", selection: ["c1"] })).toMatchObject({ source: "collection", selection: ["c1"] });
    const withPlan = pathReducer(picked(), { type: "plan-created", planId: "p1" });
    expect(pathReducer(withPlan, { type: "set-source", source: "collection", selection: [] })).toBe(withPlan);
  });

  it("leaving without a plan parks a draft; Resume restores it and Discard clears it (FR-019)", () => {
    const parked = pathReducer(picked(), { type: "leave" });
    expect(parked.parked).toBe(true);
    expect(isPathVisible(parked)).toBe(false);
    expect(hasDraft(parked)).toBe(true);
    expect(pathReducer(parked, { type: "resume" })).toMatchObject({ parked: false, step: "operations", selection: ["a", "b"] });
    expect(pathReducer(parked, { type: "discard" })).toEqual(INITIAL_PATH_STATE);
  });

  it("leaving with a plan creates no draft (FR-022)", () => {
    const withPlan = pathReducer(picked(), { type: "plan-created", planId: "p1" });
    expect(pathReducer(withPlan, { type: "leave" })).toEqual(INITIAL_PATH_STATE);
  });

  it("leaving when nothing is open changes nothing", () => {
    expect(pathReducer(INITIAL_PATH_STATE, { type: "leave" })).toBe(INITIAL_PATH_STATE);
  });
});
