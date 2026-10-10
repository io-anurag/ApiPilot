import type { WorkflowStageId } from "@apipilot/shared-domain";
import type { EntryChoice } from "./workflowCatalog";

/**
 * Section identity (AP-041). A section answers "where am I?"; it is set with a `data-section`
 * attribute and index.css re-points the `brand` scale and the section tokens at that section's
 * accent for everything inside the element. Status (success/warning/danger/info) is independent
 * of it and never derived from it.
 *
 * Presentation metadata only — not domain data, so it lives here rather than in shared-domain.
 */
export type SectionId =
  | "spec"
  | "analysis"
  | "scenarios"
  | "ai"
  | "dependencies"
  | "artifacts"
  | "execution"
  | "results";

/** The section a guided-workflow stage belongs to. */
export const STAGE_SECTIONS: Readonly<Record<WorkflowStageId, SectionId>> = {
  upload: "spec",
  analysis: "analysis",
  apiReview: "analysis",
  deterministicGeneration: "scenarios",
  aiEnhancement: "ai",
  scenarioReview: "scenarios",
  dependencyAnalysis: "dependencies",
  workflowReview: "dependencies",
  postmanGeneration: "artifacts",
  execution: "execution",
  performanceTesting: "execution",
};

/**
 * The section a top-level workflow opens in. The guided workflow has none of its own: its section
 * follows the stage on screen (reported by the page), so it is absent here.
 */
export const WORKFLOW_SECTIONS: Readonly<Record<Exclude<EntryChoice, "guided-workflow">, SectionId>> = {
  "import-collection": "execution",
  "quick-performance": "execution",
  "performance-plans": "execution",
  "user-script": "scenarios",
};
