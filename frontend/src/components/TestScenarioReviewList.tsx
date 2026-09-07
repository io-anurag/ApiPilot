import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { ReviewScenarioWire } from "../services/reviewsClient";
import { reviewStateLabel } from "./TestScenarioReviewDetail";
import { ConfirmDialog } from "./ConfirmDialog";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { BUTTON_STYLES } from "./controlStyles";

function operationKey(item: ReviewScenarioWire): string {
  return `${item.scenario.operationMethod} ${item.scenario.operationPath}`;
}

const STATE_TONES: Record<ReviewScenarioWire["state"], StatusTone> = {
  pending: "neutral",
  accepted: "success",
  rejected: "danger",
};

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
  renderSelected,
}: Readonly<{
  scenarios: ReviewScenarioWire[];
  selectedScenarioId: string | null;
  onSelect: (item: ReviewScenarioWire) => void;
  /** Applies a bulk accept/reject decision to every item in `items` (FR-004, FR-005, FR-007, FR-010). */
  onBulkDecision: (
    items: ReviewScenarioWire[],
    action: "accept" | "reject",
    reason?: string,
  ) => void;
  renderSelected?: (item: ReviewScenarioWire) => ReactNode;
}>) {
  const [operationFilter, setOperationFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [manualSelectionIds, setManualSelectionIds] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<PendingBulkAction | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Changing either filter clears the manual selection (FR-019) so a bulk action is always
  // applied against a selection made under the filter currently in view, and resets pagination
  // back to the first page of the newly filtered set.
  function updateOperationFilter(value: string) {
    setOperationFilter(value);
    setManualSelectionIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }

  function updateCategoryFilter(value: string) {
    setCategoryFilter(value);
    setManualSelectionIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }

  function updateSourceFilter(value: string) {
    setSourceFilter(value);
    setManualSelectionIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }

  const operations = useMemo(
    () =>
      [...new Set(scenarios.map(operationKey))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [scenarios],
  );
  const categories = useMemo(
    () =>
      [...new Set(scenarios.map((s) => s.scenario.category))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [scenarios],
  );
  const sources = useMemo(
    () =>
      [...new Set(scenarios.map((s) => s.scenario.provenance.source))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [scenarios],
  );

  const filtered = scenarios.filter((item) => {
    if (operationFilter !== "all" && operationKey(item) !== operationFilter) return false;
    if (categoryFilter !== "all" && item.scenario.category !== categoryFilter)
      return false;
    if (sourceFilter !== "all" && item.scenario.provenance.source !== sourceFilter)
      return false;
    return true;
  });

  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((item) => manualSelectionIds.has(item.scenarioId));

  const manuallySelected = scenarios.filter((item) =>
    manualSelectionIds.has(item.scenarioId),
  );

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
    <div data-testid="review-scenario-list" className="flex flex-col gap-3">
      <div className="order-2 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="review-operation-filter"
            className="text-xs font-medium text-muted"
          >
            Operation
          </label>
          <select
            id="review-operation-filter"
            value={operationFilter}
            onChange={(e) => updateOperationFilter(e.target.value)}
            className="max-w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
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
          <label
            htmlFor="review-category-filter"
            className="text-xs font-medium text-muted"
          >
            Category
          </label>
          <select
            id="review-category-filter"
            value={categoryFilter}
            onChange={(e) => updateCategoryFilter(e.target.value)}
            className="max-w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="review-source-filter"
            className="text-xs font-medium text-muted"
          >
            Source
          </label>
          <select
            id="review-source-filter"
            value={sourceFilter}
            onChange={(e) => updateSourceFilter(e.target.value)}
            className="max-w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <option value="all">All sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source === "AI" ? "AI-suggested" : "Deterministic rule"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="order-3">
        {filtered.length === 0 ? (
          <p data-testid="review-scenario-list-empty" className="text-sm text-muted">
            No scenarios match the current filters.
          </p>
        ) : (
          <ul className="min-w-0 divide-y divide-border rounded-md border border-border">
            <li className="flex items-center gap-3 border-b border-border bg-slate-50 px-3 py-2 text-xs font-semibold text-muted">
              <span className="w-4" aria-hidden="true" />
              <span>Scenario</span>
              <span className="ml-auto">
                Select individual rows or use Select all filtered above
              </span>
            </li>
            {filtered.slice(0, visibleCount).map((item) => (
              <Fragment key={item.scenarioId}>
                <li className="flex min-w-0 items-center gap-3 px-3 py-2">
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
                    className={`flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
                      item.scenarioId === selectedScenarioId ? "bg-brand-50" : ""
                    }`}
                  >
                    <HttpMethodBadge method={item.scenario.operationMethod} />
                    <span className="min-w-0 break-all font-mono text-slate-800">
                      {item.scenario.operationPath}
                    </span>
                    <span className="text-muted">—</span>
                    <span className="text-slate-700">
                      {item.scenario.category}
                      {item.scenario.targetField ? ` — ${item.scenario.targetField}` : ""}
                    </span>
                    <ProvenanceBadge
                      source={item.scenario.provenance.source}
                      modifiedByUser={item.isUserModified}
                    />
                    <StatusBadge
                      label={reviewStateLabel(item.state)}
                      tone={STATE_TONES[item.state]}
                    />
                  </button>
                </li>
                {item.scenarioId === selectedScenarioId && (
                  <li className="border-t border-brand-200 bg-brand-50/20">
                    {renderSelected?.(item)}
                  </li>
                )}
              </Fragment>
            ))}
          </ul>
        )}
      </div>

      <div
        data-testid="review-bulk-actions"
        className="order-1 flex flex-wrap items-center gap-2 rounded-md border border-brand-200 bg-brand-50 p-3"
      >
        <label className="mr-2 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={() => {
              setManualSelectionIds((previous) => {
                const next = new Set(previous);
                if (allFilteredSelected)
                  filtered.forEach((item) => next.delete(item.scenarioId));
                else filtered.forEach((item) => next.add(item.scenarioId));
                return next;
              });
            }}
            aria-label="Select all filtered scenarios"
            className="h-4 w-4 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          Select all filtered ({filtered.length})
        </label>
        {filtered.length > 0 && (
          <>
            <button
              type="button"
              onClick={() =>
                setPendingBulk({ scope: "filtered", action: "accept", items: filtered })
              }
              className={BUTTON_STYLES.secondary}
            >
              Accept all filtered ({filtered.length})
            </button>
            <button
              type="button"
              onClick={() =>
                setPendingBulk({ scope: "filtered", action: "reject", items: filtered })
              }
              className={BUTTON_STYLES.secondary}
            >
              Reject all filtered ({filtered.length})
            </button>
          </>
        )}
        {manuallySelected.length > 0 && (
          <>
            <button
              type="button"
              onClick={() =>
                setPendingBulk({
                  scope: "selected",
                  action: "accept",
                  items: manuallySelected,
                })
              }
              className={BUTTON_STYLES.secondary}
            >
              Accept selected ({manuallySelected.length})
            </button>
            <button
              type="button"
              onClick={() =>
                setPendingBulk({
                  scope: "selected",
                  action: "reject",
                  items: manuallySelected,
                })
              }
              className={BUTTON_STYLES.secondary}
            >
              Reject selected ({manuallySelected.length})
            </button>
          </>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="order-4 flex items-center justify-between text-sm text-muted">
          <span>
            Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
          </span>
          {filtered.length > visibleCount && (
            <button
              type="button"
              aria-label={`Load more scenarios; showing ${Math.min(visibleCount, filtered.length)} of ${filtered.length}`}
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className={BUTTON_STYLES.secondary}
            >
              Load more
            </button>
          )}
        </div>
      )}

      {pendingBulk && (
        <ConfirmDialog
          message={`${pendingBulk.action === "accept" ? "Accept" : "Reject"} ${pendingBulk.scope === "filtered" ? "every scenario matching the current filter" : "the selected scenarios"}?`}
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
