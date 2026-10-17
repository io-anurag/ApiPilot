import type { GuidedWorkflowSummary } from "../../../hooks/useGuidedWorkflowSummary";
import { EmptyState } from "../../EmptyState";
import { ErrorState } from "../../ErrorState";
import { Banner } from "../../patterns/Banner";
import { Card, CardHeader } from "../../patterns/Card";
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
      <EmptyState message="No guided workflow is in progress in this session." description="Run the guided workflow up to Postman generation first, then start from it here." testId="workflow-summary-none" />
    );
  }
  return (
    <Card as="section" variant="flat" aria-labelledby="workflow-summary-title" className="space-y-2" data-testid="workflow-summary">
      <CardHeader title="What will be seeded" titleId="workflow-summary-title" level={3} />
      <p className="max-w-3xl text-sm text-text-secondary">
        From the guided workflow for <span className="font-mono text-xs">{summary.specificationFilename}</span>: {plural(summary.approvedWorkflowCount, "approved workflow", "approved workflows")}, each a chain with its values passed between steps, and{" "}
        {plural(summary.otherOperationCount, "other operation", "other operations")} as single steps. Workflows are seeded whole; you edit every request afterwards.
      </p>
      {summary.kind === "not-ready" && <Banner tone="warning" role="status" title="Finish the guided workflow up to Postman generation first. Nothing can be seeded until then." />}
    </Card>
  );
}
