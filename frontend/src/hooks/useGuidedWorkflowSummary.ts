import { useEffect, useState } from "react";
import { fetchCurrentWorkflow } from "../services/testGenerationWorkflowClient";

export type GuidedWorkflowSummary =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** No guided workflow is in progress in this session. */
  | { kind: "none" }
  | { kind: "ready" | "not-ready"; specificationFilename: string; approvedWorkflowCount: number; otherOperationCount: number };

/**
 * What seeding a plan from the guided workflow would use (specs/047-unified-performance-tab FR-008): the
 * approved workflows, each seeded whole as one chain, and every other operation in scope as a single step.
 * The workflow is ready once Postman generation is complete, the same gate the seed route applies
 * (specs/037 FR-023). Read only; nothing is created. Reads only while `enabled`.
 */
export function useGuidedWorkflowSummary(enabled: boolean): GuidedWorkflowSummary {
  const [summary, setSummary] = useState<GuidedWorkflowSummary>({ kind: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSummary({ kind: "loading" });
    void fetchCurrentWorkflow().then((result) => {
      if (cancelled) return;
      if (!result.ok) return setSummary({ kind: "error", message: result.message });
      const workflow = result.workflow;
      if (!workflow) return setSummary({ kind: "none" });
      const inScope = workflow.selectedOperationKeys?.length ?? workflow.apiModel?.operations.length ?? 0;
      const approved = workflow.approvedWorkflowIds?.length ?? 0;
      setSummary({
        kind: workflow.stages.postmanGeneration.status === "complete" ? "ready" : "not-ready",
        specificationFilename: workflow.specificationFilename,
        approvedWorkflowCount: approved,
        otherOperationCount: Math.max(0, inScope - approved),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return enabled ? summary : { kind: "idle" };
}
