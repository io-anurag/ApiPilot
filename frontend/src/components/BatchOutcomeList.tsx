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
    // A wrapping row rather than a fixed-column grid: fixed columns squeezed each badge narrower
    // than its own label, wrapping "Batch 1: Succeeded" onto two lines. A batch carrying a failure
    // explanation takes a full line of its own so that sentence stays readable beside its badge.
    <ul aria-label="Batch outcomes" className="mt-2 flex flex-wrap gap-1.5">
      {batchOutcomes.map((batch) => (
        <li
          key={batch.index}
          className={`flex items-baseline gap-2 ${batch.failureExplanation ? "basis-full flex-wrap" : "whitespace-nowrap"}`}
        >
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
            <span className="text-xs text-slate-600 dark:text-slate-400">{batch.failureExplanation.summary}</span>
          )}
          {renderAction?.(batch)}
        </li>
      ))}
    </ul>
  );
}
