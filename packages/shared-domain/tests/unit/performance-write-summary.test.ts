import { describe, expect, it } from "vitest";
import {
  summarizeWriteOperations,
  WRITE_EFFECT_LABELS,
  writeEffectOf,
  type PerformanceJourney,
  type PerformanceStep,
} from "../../src";

/** AP-032 FR-009 to FR-012 (specs/032-quick-performance-test research Q9, tasks T040). */

function step(id: string, method: string, path: string): PerformanceStep {
  return {
    id,
    operationKey: `${method} ${path}`,
    method,
    path,
    scenarioId: `sc-${id}`,
    scenarioDescription: "",
    scenarioChoice: "rule-generated",
    tieBrokenByLowestId: false,
    consumes: [],
    produces: [],
    variableBindings: [],
    dependency: null,
    expectedStatuses: [],
    auth: { kind: "none", schemeName: null },
    requiredValues: [],
  };
}

function journey(id: string, steps: PerformanceStep[]): PerformanceJourney {
  return { id, source: { kind: "operation" }, steps };
}

describe("summarizeWriteOperations", () => {
  it("counts distinct write operations per method in POST, PUT, PATCH, DELETE order, omitting zero counts", () => {
    const summary = summarizeWriteOperations([
      journey("j1", [step("a", "DELETE", "/orders/{id}")]),
      journey("j2", [step("b", "POST", "/orders")]),
      journey("j3", [step("c", "GET", "/orders")]),
      journey("j4", [step("d", "POST", "/products")]),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byMethod).toEqual([
      { method: "POST", count: 2 },
      { method: "DELETE", count: 1 },
    ]);
  });

  it("lists each operation once in plan order, with every step it appears in and that step's journey", () => {
    const summary = summarizeWriteOperations([
      { id: "wf1", source: { kind: "workflow", workflowId: "w1" }, steps: [step("a", "POST", "/orders"), step("b", "GET", "/orders/{id}")] },
      { id: "wf2", source: { kind: "workflow", workflowId: "w2" }, steps: [step("c", "POST", "/orders"), step("d", "PATCH", "/orders/{id}")] },
    ]);
    expect(summary.operations).toEqual([
      {
        operationKey: "POST /orders",
        method: "POST",
        path: "/orders",
        effect: "creates",
        stepIds: ["a", "c"],
        steps: [
          { stepId: "a", journeyId: "wf1", journeyLabel: "J1" },
          { stepId: "c", journeyId: "wf2", journeyLabel: "J2" },
        ],
      },
      { operationKey: "PATCH /orders/{id}", method: "PATCH", path: "/orders/{id}", effect: "updates", stepIds: ["d"], steps: [{ stepId: "d", journeyId: "wf2", journeyLabel: "J2" }] },
    ]);
  });

  it("never counts GET, HEAD or OPTIONS, and gives total 0 for a read-only plan (FR-012)", () => {
    const summary = summarizeWriteOperations([journey("j", [step("a", "GET", "/a"), step("b", "HEAD", "/a"), step("c", "OPTIONS", "/a")])]);
    expect(summary).toEqual({ total: 0, byMethod: [], operations: [] });
  });

  it("names each write's effect in text (FR-010)", () => {
    expect(WRITE_EFFECT_LABELS).toEqual({ POST: "Creates", PUT: "Replaces", PATCH: "Updates", DELETE: "Deletes" });
    expect(writeEffectOf("put")).toBe("replaces");
    expect(writeEffectOf("GET")).toBeNull();
  });
});

/** AP-035 FR-023 (specs/035-user-defined-journeys research R15; tasks T040). */
describe("summarizeWriteOperations counts steps (AP-035 FR-023)", () => {
  it("counts each step that sends a write, names its journey, and leaves out an incomplete journey", () => {
    const summary = summarizeWriteOperations([
      { id: "u1", source: { kind: "user", userJourneyId: "u1", name: "Lifecycle" }, steps: [step("a", "POST", "/customers"), step("b", "PUT", "/customers/{id}"), step("c", "PUT", "/customers/{id}")] },
      journey("j2", [step("d", "POST", "/customers")]),
      { id: "u3", source: { kind: "user", userJourneyId: "u3", name: "Half" }, steps: [step("e", "DELETE", "/customers/{id}")], incompleteReason: { missingOperationKeys: ["GET /x"] } },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.byMethod).toEqual([
      { method: "POST", count: 2 },
      { method: "PUT", count: 2 },
    ]);
    expect(summary.operations[0].steps).toEqual([
      { stepId: "a", journeyId: "u1", journeyLabel: "J1 Lifecycle" },
      { stepId: "d", journeyId: "j2", journeyLabel: "J2" },
    ]);
  });

  it("gives today's numbers for a plan with each operation in one step", () => {
    const summary = summarizeWriteOperations([journey("j1", [step("a", "POST", "/a")]), journey("j2", [step("b", "DELETE", "/a/{id}")])]);
    expect(summary.total).toBe(2);
  });
});
