import { describe, expect, it } from "vitest";
import {
  ARTIFACT_CHOICES,
  WORKFLOWS,
  workflowById,
} from "../../src/components/workflowCatalog";

describe("workflowCatalog (AP-038 research.md D4)", () => {
  it("lists the five top-level views in tab order, with the tab labels unchanged (FR-013)", () => {
    expect(WORKFLOWS.map((w) => [w.id, w.tabLabel])).toEqual([
      ["guided-workflow", "Guided Workflow"],
      ["import-collection", "Import & Run Collection"],
      ["quick-performance", "Quick Performance Test"],
      ["performance-plans", "Performance Plans"],
      ["user-script", "Run k6 Script"],
    ]);
  });

  it("keeps the start screen's titles and one-sentence descriptions verbatim", () => {
    expect(WORKFLOWS.map((w) => w.title)).toEqual([
      "Guided Workflow",
      "Import & Run Collection",
      "Quick performance test",
      "Performance plans",
      "Run k6 Script",
    ]);
    expect(workflowById("quick-performance").description).toBe(
      "Turn an OpenAPI specification into a k6 load test when you need fast signal, not review.",
    );
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
      ["openapi", ["guided-workflow", "quick-performance"]],
      ["postman", ["import-collection"]],
      ["k6", ["user-script"]],
    ]);
    for (const artifact of ARTIFACT_CHOICES) {
      for (const id of artifact.workflows) expect(() => workflowById(id)).not.toThrow();
    }
  });
});
