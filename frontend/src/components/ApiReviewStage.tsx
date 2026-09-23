import { useMemo, useState } from "react";
import { toOperationKey, type ApiModel, type ApiOperation } from "@apipilot/shared-domain";
import { AnalysisSummary } from "./AnalysisSummary";
import { ErrorState } from "./ErrorState";
import { OperationDetail } from "./OperationDetail";
import { OperationList } from "./OperationList";
import { SummaryPanel } from "./SummaryPanel";
import { BUTTON_STYLES } from "./controlStyles";
import {
  continueApiReview,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import { groupOperationsByMethod } from "../utils/operationMethodGroups";

/** What the summary panel says about the scope "Continue" will carry forward. */
function scopeDescription(
  checkedCount: number,
  totalCount: number,
  readOnly: boolean,
): string {
  if (readOnly) {
    return checkedCount === 0
      ? `All ${totalCount} discovered operations were carried into test generation and AI enhancement.`
      : `${checkedCount} of ${totalCount} operations were carried into test generation and AI enhancement.`;
  }
  if (totalCount === 0) return "No operations were discovered, so there is nothing to select.";
  return checkedCount === 0
    ? "Select at least one operation to continue, or use Select all to include every operation."
    : `Only the selected operations, and the schemas they reference, go to test generation and AI enhancement.`;
}

/**
 * The apiReview stage: the existing analysis display (AP-002 components) plus per-operation
 * inclusion checkboxes (specs/009 Clarifications 2026-09-23, superseding research.md D3's
 * confirmation-only gate). "Continue" stays disabled until at least one operation is checked, so
 * the scope carried forward is always an explicit user choice (FR-009) — "Select all" is how a
 * user chooses every operation. The API itself still treats an absent selection as "all"
 * for backward compatibility; only this screen requires the explicit choice.
 *
 * `readOnly` renders the same display without the "Continue" action, for a QA engineer looking
 * back at an already-completed apiReview stage; the recorded selection (`selectedOperationKeys`)
 * is shown as disabled checkboxes. The selection is not revisable once recorded.
 */
export function ApiReviewStage({
  apiModel,
  onAdvanced,
  readOnly = false,
  selectedOperationKeys,
}: Readonly<{
  apiModel: ApiModel;
  onAdvanced: (result: WorkflowResult) => void;
  readOnly?: boolean;
  selectedOperationKeys?: readonly string[];
}>) {
  const [selected, setSelected] = useState<ApiOperation | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(
    () => new Set(selectedOperationKeys ?? []),
  );
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allKeys = useMemo(() => apiModel.operations.map(toOperationKey), [apiModel.operations]);
  const total = allKeys.length;
  const checkedCount = checkedKeys.size;
  const allChecked = total > 0 && checkedCount === total;
  // Gated only when there is something to choose: a specification with no operations must still
  // be able to continue, or the workflow would be stuck at this stage.
  const selectionRequired = total > 0 && checkedCount === 0;
  // A completed stage with no recorded selection carried every operation forward (absent means
  // "all"); otherwise the summary counts exactly the checked operations "Continue" will send.
  const carriedAll = readOnly && checkedCount === 0;
  const inScopeOperations = useMemo(
    () =>
      carriedAll
        ? apiModel.operations
        : apiModel.operations.filter((operation) => checkedKeys.has(toOperationKey(operation))),
    [apiModel.operations, checkedKeys, carriedAll],
  );
  // A read-only stage that carried every operation forward has no subset to display.
  const showInclusion = !readOnly || (selectedOperationKeys?.length ?? 0) > 0;

  function toggle(key: string) {
    setCheckedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleContinue() {
    setContinuing(true);
    setError(null);
    // Sent in apiModel order; the backend normalizes order too, so this is only for readability.
    const result = await continueApiReview(allKeys.filter((key) => checkedKeys.has(key)));
    setContinuing(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  return (
    <section
      data-testid="api-review-stage"
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <div className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Review Discovered APIs</h2>
        <AnalysisSummary summary={apiModel.summary} />
        {!readOnly && total > 0 && (
          <div
            data-testid="api-review-selection-bar"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-500 dark:bg-brand-500/10"
          >
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(element) => {
                  if (element) element.indeterminate = checkedCount > 0 && !allChecked;
                }}
                onChange={() => setCheckedKeys(allChecked ? new Set() : new Set(allKeys))}
                disabled={continuing}
                className="h-4 w-4 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
              Select all ({total})
            </label>
            <p className="text-sm text-muted" aria-live="polite">
              {checkedCount === 0 ? "None selected" : `${checkedCount} selected`}
            </p>
          </div>
        )}
        <OperationList
          operations={apiModel.operations}
          selected={selected}
          onSelect={setSelected}
          inclusion={
            showInclusion
              ? { checkedKeys, onToggle: toggle, disabled: readOnly || continuing }
              : undefined
          }
          renderSelected={(operation) => (
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                  Operation details
                </p>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className={BUTTON_STYLES.secondary}
                >
                  Close details
                </button>
              </div>
              <OperationDetail operation={operation} />
            </div>
          )}
        />
        {error && <ErrorState testId="api-review-error" message={error} />}
      </div>
      <SummaryPanel
        testId="api-review-summary-panel"
        statValue={inScopeOperations.length}
        statLabel={
          carriedAll
            ? `operation${total === 1 ? "" : "s"} discovered`
            : `of ${total} operation${total === 1 ? "" : "s"} selected`
        }
        segments={groupOperationsByMethod(inScopeOperations)}
        description={scopeDescription(checkedCount, total, readOnly)}
        action={
          !readOnly
            ? {
                label: continuing ? "Continuing…" : "Continue",
                onClick: handleContinue,
                disabled: continuing || selectionRequired,
              }
            : undefined
        }
      />
    </section>
  );
}
