import type { GuidedWorkflowSummary } from "../../../hooks/useGuidedWorkflowSummary";
import { ErrorState } from "../../ErrorState";
import { Skeleton } from "../../Skeleton";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The Workflows step for the guided workflow (specs/047-unified-performance-tab FR-008): a read-only
 * summary of what will be seeded. Approved workflows are seeded whole, one chain each, and cannot be
 * chosen one by one; every other operation in scope becomes a single step. Until the guided workflow has
 * reached Postman generation there is nothing to seed, and the step says what to finish first.
 */
export function WorkflowSummary({ summary }: Readonly<{ summary: GuidedWorkflowSummary }>) {
  if (summary.kind === "idle" || summary.kind === "loading") {
    return (
      <div role="status" aria-label="Reading the guided workflow">
        <Skeleton className="h-16 w-full rounded bg-surface-strong" />
      </div>
    );
  }
  if (summary.kind === "error") return <ErrorState message="The guided workflow could not be read." detail={summary.message} testId="workflow-summary-error" />;
  if (summary.kind === "none") {
    return (
      <p className="max-w-3xl rounded-lg border border-dashed border-border p-4 text-sm text-muted" data-testid="workflow-summary-none">
        No guided workflow is in progress in this session. Run the guided workflow up to Postman generation first, then start from it here.
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="workflow-summary">
      <h3 className="text-base font-semibold">What will be seeded</h3>
      <p className="max-w-3xl text-sm text-muted">
        From the guided workflow for <span className="font-mono text-xs">{summary.specificationFilename}</span>: {plural(summary.approvedWorkflowCount, "approved workflow", "approved workflows")}, each a chain with its values passed between steps, and{" "}
        {plural(summary.otherOperationCount, "other operation", "other operations")} as single steps. Workflows are seeded whole; you edit every request afterwards.
      </p>
      {summary.kind === "not-ready" && (
        <p role="status" className="text-sm font-medium text-warning-700 dark:text-warning-100">
          Finish the guided workflow up to Postman generation first. Nothing can be seeded until then.
        </p>
      )}
    </div>
  );
}
