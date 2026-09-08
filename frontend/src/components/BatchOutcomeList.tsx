import type { BatchOutcomeRecord } from "@apipilot/shared-domain";
import { StatusBadge } from "./StatusBadge";

/**
 * Per-batch status/reason list for a settled AI Enhancement run (specs/015-ai-batch-retry
 * FR-001, FR-011). Shared between `AiEnhancementOutcomeSummary` (read-only, US2) and
 * `AiEnhancementStage`'s skipped/partial banner (adds a retry action per eligible batch via
 * `renderAction`, US1) so the row rendering exists in exactly one place.
 */
export function BatchOutcomeList({
  batchOutcomes,
  renderAction,
}: Readonly<{
  batchOutcomes: BatchOutcomeRecord[] | undefined;
  renderAction?: (batch: BatchOutcomeRecord) => React.ReactNode;
}>) {
  if (!batchOutcomes || batchOutcomes.length === 0) return null;

  return (
    <ul
      aria-label="Batch outcomes"
      className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
    >
      {batchOutcomes.map((batch) => (
        <li key={batch.index} className="flex flex-wrap items-baseline gap-2">
          <StatusBadge
            label={`Batch ${batch.index + 1}: ${batch.status === "succeeded" ? "Succeeded" : batch.status === "not-attempted" ? "Not attempted" : "Failed"}`}
            tone={
              batch.status === "succeeded"
                ? "success"
                : batch.status === "not-attempted"
                  ? "warning"
                  : "danger"
            }
          />
          {batch.failureExplanation && (
            <span className="text-xs text-slate-600">{batch.failureExplanation.summary}</span>
          )}
          {renderAction?.(batch)}
        </li>
      ))}
    </ul>
  );
}
