import { describe, expect, it } from "vitest";
import {
  ARTIFACT_CHOICES,
  WORKFLOWS,
  workflowById,
} from "../../src/components/workflowCatalog";

describe("workflowCatalog (AP-038 research.md D4)", () => {
  it("lists the four workflows in tab order, with the one Performance tab replacing the two earlier ones (FR-013, AP-047 FR-001)", () => {
    expect(WORKFLOWS.map((w) => [w.id, w.tabLabel])).toEqual([
      ["guided-workflow", "Guided Workflow"],
      ["import-collection", "Import & Run Collection"],
      ["performance", "Performance"],
      ["user-script", "Run k6 Script"],
    ]);
  });

  it("keeps the start screen's titles and one-sentence descriptions verbatim", () => {
    expect(WORKFLOWS.map((w) => w.title)).toEqual([
      "Guided Workflow",
      "Import & Run Collection",
      "Performance",
      "Run k6 Script",
    ]);
    expect(workflowById("performance").description).toBe(
      "Turn a specification, a guided workflow or a collection into a k6 load test: pick a source, review the plan, set the load and run.",
    );
  });

  it("offers one performance entry on the start screen and none of the two it replaces (AP-047 SC-006)", () => {
    const ids = WORKFLOWS.map((w) => w.id as string);
    expect(ids.filter((id) => id.includes("performance"))).toEqual(["performance"]);
    expect(ids).not.toContain("quick-performance");
    expect(ids).not.toContain("performance-plans");
  });

  it("recommends only the guided workflow", () => {
    expect(WORKFLOWS.filter((w) => w.recommended).map((w) => w.id)).toEqual([
      "guided-workflow",
    ]);
  });

  it("gives every workflow its own colour", () => {
    expect(new Set(WORKFLOWS.map((w) => w.tone.marker)).size).toBe(WORKFLOWS.length);
  });

  it("points each artifact only at workflows that exist and accept it (FR-009)", () => {
    expect(ARTIFACT_CHOICES.map((a) => [a.id, a.workflows])).toEqual([
      ["openapi", ["guided-workflow", "performance"]],
      ["postman", ["import-collection"]],
      ["k6", ["user-script"]],
    ]);
    for (const artifact of ARTIFACT_CHOICES) {
      for (const id of artifact.workflows) expect(() => workflowById(id)).not.toThrow();
    }
  });
});
