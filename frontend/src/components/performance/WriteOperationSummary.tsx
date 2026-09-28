import type { ReactNode } from "react";
import { WRITE_EFFECT_LABELS, type WriteOperationSummary as Summary } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { CountedOperationList } from "./CountedOperationList";

/**
 * What the plan's write operations will do to the target (AP-032 FR-009 to FR-012a, SC-002): shown
 * above the journeys (`plan`) and beside the run trigger (`trigger`), on both paths. Every write
 * operation is listed by method and path in both places and the list never collapses: the
 * constitution's XVII extension of 2026-09-27 rests on every write being visible on the plan and at
 * the run trigger (research Q9). Meaning is always carried by text, never by colour alone.
 */
export const WRITE_REPETITION_SENTENCE =
  "Every virtual user sends each of these on every iteration for the whole run, so each one creates, changes or deletes data on the target every time it is sent. ApiPilot does not clean up after the run.";

export function writeCountLabel(total: number): string {
  return total === 1 ? "1 write operation will be sent" : `${total} write operations will be sent`;
}

export function WriteOperationSummary({
  summary,
  variant,
  listId,
  actions,
}: Readonly<{
  summary: Summary;
  variant: "plan" | "trigger";
  /** The plan variant's anchor, so the trigger can point back to it. */
  listId?: string;
  /** Plan variant only: bulk removal controls. */
  actions?: ReactNode;
}>) {
  if (summary.total === 0) {
    return (
      <p data-testid={`write-summary-${variant}`} className="text-sm">
        <StatusBadge label="Read only" tone="success" /> This plan sends only read requests.
      </p>
    );
  }

  const counts = (
    <ul className="flex flex-wrap gap-2" aria-label="Write operations per method">
      {summary.byMethod.map((entry) => (
        <li key={entry.method} className="inline-flex items-center gap-1 text-sm">
          <HttpMethodBadge method={entry.method} />
          <span className="font-mono">× {entry.count}</span>
        </li>
      ))}
    </ul>
  );
  const entries = summary.operations.map((operation) => ({
    operationKey: operation.operationKey,
    detail: <StatusBadge label={WRITE_EFFECT_LABELS[operation.method]} tone="warning" />,
  }));

  if (variant === "trigger") {
    return (
      <section aria-label="Write operations this run sends" data-testid="write-summary-trigger" className="space-y-1.5 rounded-md border border-warning-500 bg-warning-50 p-3 dark:bg-warning-500/10">
        <p className="text-sm font-semibold text-warning-700 dark:text-warning-100">
          <StatusBadge label="Writes" tone="warning" /> {writeCountLabel(summary.total)}
          {listId && (
            <>
              {" "}
              <a href={`#${listId}`} className="text-xs font-normal underline">
                See the plan&apos;s list
              </a>
            </>
          )}
        </p>
        {counts}
        <div className="max-h-48 overflow-y-auto">
          <CountedOperationList label={() => "Write operations"} entries={entries} collapseAbove={Infinity} testId="write-summary-trigger-list" />
        </div>
      </section>
    );
  }

  return (
    <section id={listId} aria-labelledby="write-summary-title" data-testid="write-summary-plan" className="space-y-2 rounded-lg border border-warning-500 bg-warning-50 p-4 dark:bg-warning-500/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="write-summary-title" className="text-base font-semibold text-warning-700 dark:text-warning-100">
          <StatusBadge label="Writes" tone="warning" /> {writeCountLabel(summary.total)}
        </h3>
        {actions}
      </div>
      {counts}
      <p className="text-sm">{WRITE_REPETITION_SENTENCE}</p>
      <CountedOperationList label={(count) => `${count} write operations`} entries={entries} collapseAbove={Infinity} testId="write-summary-plan-list" />
    </section>
  );
}
