import { useMemo, useState } from "react";
import type { ReviewScenarioWire } from "../services/reviewsClient";
import { reviewStateLabel } from "./TestScenarioReviewDetail";
import { ConfirmDialog } from "./ConfirmDialog";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { ProvenanceBadge } from "./ProvenanceBadge";

function operationKey(item: ReviewScenarioWire): string {
  return `${item.scenario.operationMethod} ${item.scenario.operationPath}`;
}

const STATE_TONES: Record<ReviewScenarioWire["state"], StatusTone> = {
  pending: "neutral",
  accepted: "success",
  rejected: "danger",
};

const BUTTON_CLASSES =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

type PendingBulkAction = {
  scope: "filtered" | "selected";
  action: "accept" | "reject";
  items: ReviewScenarioWire[];
};

/** Rows rendered per page; a large-but-bounded default keeps every existing test's small fixture
 * fully visible without paging while still capping DOM size for hundreds of real scenarios. */
const PAGE_SIZE = 50;

/** Lists review scenarios with operation/category filtering and accessible selection (US1, FR-002). */
export function TestScenarioReviewList({
  scenarios,
  selectedScenarioId,
  onSelect,
  onBulkDecision,
}: {
  scenarios: ReviewScenarioWire[];
  selectedScenarioId: string | null;
  onSelect: (item: ReviewScenarioWire) => void;
  /** Applies a bulk accept/reject decision to every item in `items` (FR-004, FR-005, FR-007, FR-010). */
  onBulkDecision: (items: ReviewScenarioWire[], action: "accept" | "reject", reason?: string) => void;
}) {
  const [operationFilter, setOperationFilterState] = useState("all");
  const [categoryFilter, setCategoryFilterState] = useState("all");
  const [manualSelectionIds, setManualSelectionIds] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<PendingBulkAction | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Changing either filter clears the manual selection (FR-019) so a bulk action is always
  // applied against a selection made under the filter currently in view, and resets pagination
  // back to the first page of the newly filtered set.
  function setOperationFilter(value: string) {
    setOperationFilterState(value);
    setManualSelectionIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }

  function setCategoryFilter(value: string) {
    setCategoryFilterState(value);
    setManualSelectionIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }

  const operations = useMemo(
    () => [...new Set(scenarios.map(operationKey))].sort(),
    [scenarios],
  );
  const categories = useMemo(
    () => [...new Set(scenarios.map((s) => s.scenario.category))].sort(),
    [scenarios],
  );

  const filtered = scenarios.filter((item) => {
    if (operationFilter !== "all" && operationKey(item) !== operationFilter) return false;
    if (categoryFilter !== "all" && item.scenario.category !== categoryFilter)
      return false;
    return true;
  });

  const manuallySelected = scenarios.filter((item) => manualSelectionIds.has(item.scenarioId));

  function toggleManualSelection(scenarioId: string) {
    setManualSelectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(scenarioId)) {
        next.delete(scenarioId);
      } else {
        next.add(scenarioId);
      }
      return next;
    });
  }

  function handleConfirmBulk(reason?: string) {
    if (!pendingBulk) return;
    onBulkDecision(pendingBulk.items, pendingBulk.action, reason);
    setPendingBulk(null);
    setManualSelectionIds(new Set());
  }

  return (
    <div data-testid="review-scenario-list" className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="review-operation-filter" className="text-xs font-medium text-muted">
            Operation
          </label>
          <select
            id="review-operation-filter"
            value={operationFilter}
            onChange={(e) => setOperationFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <option value="all">All operations</option>
            {operations.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="review-category-filter" className="text-xs font-medium text-muted">
            Category
          </label>
          <select
            id="review-category-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div data-testid="review-bulk-actions" className="flex flex-wrap gap-2">
        {filtered.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setPendingBulk({ scope: "filtered", action: "accept", items: filtered })}
              className={BUTTON_CLASSES}
            >
              Accept all filtered ({filtered.length})
            </button>
            <button
              type="button"
              onClick={() => setPendingBulk({ scope: "filtered", action: "reject", items: filtered })}
              className={BUTTON_CLASSES}
            >
              Reject all filtered ({filtered.length})
            </button>
          </>
        )}
        {manuallySelected.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setPendingBulk({ scope: "selected", action: "accept", items: manuallySelected })}
              className={BUTTON_CLASSES}
            >
              Accept selected ({manuallySelected.length})
            </button>
            <button
              type="button"
              onClick={() => setPendingBulk({ scope: "selected", action: "reject", items: manuallySelected })}
              className={BUTTON_CLASSES}
            >
              Reject selected ({manuallySelected.length})
            </button>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <p data-testid="review-scenario-list-empty" className="text-sm text-muted">
          No scenarios match the current filters.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {filtered.slice(0, visibleCount).map((item) => (
            <li key={item.scenarioId} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={manualSelectionIds.has(item.scenarioId)}
                onChange={() => toggleManualSelection(item.scenarioId)}
                aria-label={`Select ${operationKey(item)} — ${item.scenario.category} scenario`}
                className="h-4 w-4 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              <button
                type="button"
                aria-pressed={item.scenarioId === selectedScenarioId}
                onClick={() => onSelect(item)}
                className={`flex flex-1 flex-wrap items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
                  item.scenarioId === selectedScenarioId ? "bg-brand-50" : ""
                }`}
              >
                <HttpMethodBadge method={item.scenario.operationMethod} />
                <span className="font-mono text-slate-800">{item.scenario.operationPath}</span>
                <span className="text-muted">—</span>
                <span className="text-slate-700">
                  {item.scenario.category}
                  {item.scenario.targetField ? ` — ${item.scenario.targetField}` : ""}
                </span>
                <ProvenanceBadge source={item.scenario.provenance.source} modifiedByUser={item.isUserModified} />
                <StatusBadge label={reviewStateLabel(item.state)} tone={STATE_TONES[item.state]} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
          </span>
          {filtered.length > visibleCount && (
            <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className={BUTTON_CLASSES}>
              Load more
            </button>
          )}
        </div>
      )}

      {pendingBulk && (
        <ConfirmDialog
          message={
            pendingBulk.action === "accept"
              ? `Accept ${pendingBulk.scope === "filtered" ? "every scenario matching the current filter" : "the selected scenarios"}?`
              : `Reject ${pendingBulk.scope === "filtered" ? "every scenario matching the current filter" : "the selected scenarios"}?`
          }
          affectedCount={pendingBulk.items.length}
          requireReason={pendingBulk.action === "reject"}
          confirmLabel={pendingBulk.action === "accept" ? "Accept" : "Reject"}
          onConfirm={handleConfirmBulk}
          onCancel={() => setPendingBulk(null)}
        />
      )}
    </div>
  );
}
