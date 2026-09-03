import { useMemo, useState } from "react";
import type { ReviewScenarioWire } from "../services/reviewsClient";
import { reviewStateLabel } from "./TestScenarioReviewDetail";

function operationKey(item: ReviewScenarioWire): string {
  return `${item.scenario.operationMethod} ${item.scenario.operationPath}`;
}

/** Lists review scenarios with operation/category filtering and accessible selection (US1, FR-001, FR-002). */
export function TestScenarioReviewList({
  scenarios,
  selectedScenarioId,
  onSelect,
}: {
  scenarios: ReviewScenarioWire[];
  selectedScenarioId: string | null;
  onSelect: (item: ReviewScenarioWire) => void;
}) {
  const [operationFilter, setOperationFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

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

  return (
    <div data-testid="review-scenario-list">
      <div>
        <label htmlFor="review-operation-filter">Operation</label>
        <select
          id="review-operation-filter"
          value={operationFilter}
          onChange={(e) => setOperationFilter(e.target.value)}
        >
          <option value="all">All operations</option>
          {operations.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>

        <label htmlFor="review-category-filter">Category</label>
        <select
          id="review-category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p data-testid="review-scenario-list-empty">
          No scenarios match the current filters.
        </p>
      ) : (
        <ul>
          {filtered.map((item) => (
            <li key={item.scenarioId}>
              <button
                type="button"
                aria-pressed={item.scenarioId === selectedScenarioId}
                onClick={() => onSelect(item)}
              >
                {operationKey(item)} — {item.scenario.category}
                {item.scenario.targetField ? ` — ${item.scenario.targetField}` : ""} (
                {reviewStateLabel(item.state)})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
