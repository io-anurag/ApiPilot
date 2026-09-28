import { useEffect, useState } from "react";
import {
  writeEffectLabelOf,
  type PerformanceJourney,
  type PerformanceStep,
  type StepRequestPreview as Preview,
} from "@apipilot/shared-domain";
import type { Result } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { AUTH_LABEL, choiceNote } from "./performanceViewModel";
import { StepRequestPreview } from "./StepRequestPreview";

const PAGE_SIZE = 25;
const ROW_ACTION =
  "rounded border border-border bg-surface px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-white/10";
const EXPECTED_STATUS_HINT_ID = "performance-expected-status-hint";

type InventoryRow = {
  readonly journey: PerformanceJourney;
  readonly journeyIndex: number;
  readonly step: PerformanceStep;
  readonly stepIndex: number;
};

function move<T>(items: readonly T[], index: number, delta: number): T[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item);
  return next;
}

function ExpectedStatusEditor({
  step,
  disabled,
  onChange,
}: Readonly<{
  step: PerformanceStep;
  disabled: boolean;
  onChange: (codes: string[]) => void;
}>) {
  const [draft, setDraft] = useState("");
  const codes = step.expectedStatuses.map((status) => status.code);
  const inputId = `expected-${step.id}`;
  const add = () => {
    const code = draft.trim().toUpperCase();
    if (!code) return;
    setDraft("");
    onChange([...codes, code]);
  };

  return (
    <div className="space-y-1.5">
      {codes.length === 0 && (
        <p className="text-xs font-semibold text-warning-700 dark:text-warning-100">
          The specification documents no success status. Set at least one.
        </p>
      )}
      <ul
        className="flex flex-wrap gap-1.5"
        aria-label={`Expected status codes for ${step.operationKey}`}
      >
        {step.expectedStatuses.map((status) => (
          <li
            key={status.code}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-500/15"
          >
            <span className="font-mono font-semibold">{status.code}</span>
            <span className="text-muted">
              {status.source === "specification" ? "from specification" : "set by you"}
            </span>
            {codes.length > 1 && (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove expected status ${status.code} from ${step.operationKey}`}
                onClick={() => onChange(codes.filter((code) => code !== status.code))}
                className="rounded px-0.5 text-muted hover:text-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                x
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          Add an expected status for {step.operationKey}
        </label>
        <input
          id={inputId}
          aria-describedby={EXPECTED_STATUS_HINT_ID}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          placeholder="201 or 2XX"
          className="w-24 shrink-0 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100"
        />
        <button
          type="button"
          disabled={disabled || !draft.trim()}
          onClick={add}
          className={ROW_ACTION}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function variablesFor(step: PerformanceStep): string[] {
  return [
    ...step.variableBindings.map((binding) => `${binding.role} ${binding.variable}`),
    ...step.requiredValues
      .filter((name) => name !== "baseUrl")
      .map((name) => `needs ${name}`),
  ];
}

export function JourneyList({
  journeys,
  busy,
  announcement,
  onExpectedStatuses,
  onRemoveOperation,
  onStepOrder,
  onJourneyOrder,
  loadPreview,
  focusStepId,
}: Readonly<{
  journeys: PerformanceJourney[];
  busy: boolean;
  announcement: string;
  loadPreview: (stepId: string) => Promise<Result<{ request: Preview }>>;
  onExpectedStatuses: (stepId: string, codes: string[]) => void;
  onRemoveOperation: (operationKey: string) => void;
  onStepOrder: (journeyId: string, stepIds: string[]) => void;
  onJourneyOrder: (journeyIds: string[]) => void;
  focusStepId: string | null;
}>) {
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [readinessFilter, setReadinessFilter] = useState<"all" | "ready" | "attention">(
    "all",
  );
  const [page, setPage] = useState(0);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  useEffect(() => {
    if (focusStepId) setSelectedStepId(focusStepId);
  }, [focusStepId]);
  useEffect(() => {
    if (focusStepId && selectedStepId === focusStepId) {
      document.getElementById(`expected-${focusStepId}`)?.focus();
    }
  }, [focusStepId, selectedStepId]);
  const rows: InventoryRow[] = journeys.flatMap((journey, journeyIndex) =>
    journey.steps.map((step, stepIndex) => ({ journey, journeyIndex, step, stepIndex })),
  );
  const methods = [...new Set(rows.map(({ step }) => step.method.toUpperCase()))].sort();
  const filteredRows = rows.filter(({ step }) => {
    const text =
      `${step.method} ${step.path} ${step.operationKey} ${step.scenarioDescription}`.toLowerCase();
    const matchesReadiness =
      readinessFilter === "all" ||
      (readinessFilter === "ready"
        ? step.expectedStatuses.length > 0
        : step.expectedStatuses.length === 0);
    return (
      (methodFilter === "ALL" || step.method.toUpperCase() === methodFilter) &&
      matchesReadiness &&
      text.includes(query.toLowerCase())
    );
  });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = filteredRows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const selected =
    rows.find(({ step }) => step.id === selectedStepId) ?? visibleRows[0] ?? rows[0];
  const journeyIds = journeys.map((journey) => journey.id);
  const stepLabel = (stepId: string) =>
    rows.find(({ step }) => step.id === stepId)?.step.operationKey ?? stepId;
  const filter = (
    nextQuery: string,
    nextMethod = methodFilter,
    nextReadiness = readinessFilter,
  ) => {
    setQuery(nextQuery);
    setMethodFilter(nextMethod);
    setReadinessFilter(nextReadiness);
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p id={EXPECTED_STATUS_HINT_ID} className="text-xs text-muted">
        Expected status: a response with any other status counts as a failure. Add an
        exact code such as 201, or a range such as 2XX for any 2xx.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-chrome p-2 dark:bg-white/5">
        <label className="min-w-52 flex-1">
          <span className="sr-only">Search operations in the performance plan</span>
          <input
            value={query}
            onChange={(event) => filter(event.target.value)}
            placeholder="Search method, path, or scenario"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100"
          />
        </label>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Filter operations by method"
        >
          {["ALL", ...methods].map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => filter(query, method)}
              className={`${ROW_ACTION} ${methodFilter === method ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700 dark:text-white" : ""}`}
            >
              {method}
            </button>
          ))}
        </div>
        <select
          aria-label="Filter operations by readiness"
          value={readinessFilter}
          onChange={(event) =>
            filter(query, methodFilter, event.target.value as typeof readinessFilter)
          }
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100"
        >
          <option value="all">All states</option>
          <option value="ready">Ready</option>
          <option value="attention">Needs expected status</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table
          aria-label="Performance plan operations"
          className="w-full min-w-180 border-collapse text-sm"
        >
          <thead className="bg-chrome text-left text-xs text-muted dark:bg-white/5">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Journey
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Request
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Scenario
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Expected
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Auth
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                State
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ journey, journeyIndex, step, stepIndex }) => {
              const isSelected = selected?.step.id === step.id;
              const effect = writeEffectLabelOf(step.method);
              return (
                <tr
                  key={step.id}
                  className={`border-t border-border ${isSelected ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
                >
                  <td className="px-3 py-2.5 text-xs">
                    <span className="font-mono text-muted">
                      J{journeyIndex + 1}.{stepIndex + 1}
                    </span>
                    <div>
                      {journey.source.kind === "workflow"
                        ? "Workflow"
                        : "Single operation"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedStepId(step.id)}
                      aria-pressed={isSelected}
                      className="flex items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <HttpMethodBadge method={step.method} />
                      <span className="font-mono text-xs">{step.path}</span>
                      {effect && <StatusBadge label={effect} tone="warning" />}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{step.scenarioDescription}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {step.expectedStatuses.length > 0
                      ? step.expectedStatuses.map((status) => status.code).join(", ")
                      : "-"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{AUTH_LABEL[step.auth.kind]}</td>
                  <td className="px-3 py-2.5">
                    {step.expectedStatuses.length === 0 ? (
                      <StatusBadge label="Needs status" tone="warning" />
                    ) : (
                      <StatusBadge label="Ready" tone="success" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleRows.length === 0 && (
          <p className="p-6 text-sm text-muted">No operations match these filters.</p>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {filteredRows.length} operation{filteredRows.length === 1 ? "" : "s"} match
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={ROW_ACTION}
            disabled={currentPage === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {pageCount}
          </span>
          <button
            type="button"
            className={ROW_ACTION}
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </div>
      {selected && (
        <OperationInspector
          row={selected}
          busy={busy}
          journeyIds={journeyIds}
          stepLabel={stepLabel}
          loadPreview={loadPreview}
          onExpectedStatuses={onExpectedStatuses}
          onRemoveOperation={onRemoveOperation}
          onStepOrder={onStepOrder}
          onJourneyOrder={onJourneyOrder}
        />
      )}
    </div>
  );
}

function OperationInspector({
  row,
  busy,
  journeyIds,
  stepLabel,
  loadPreview,
  onExpectedStatuses,
  onRemoveOperation,
  onStepOrder,
  onJourneyOrder,
}: Readonly<{
  row: InventoryRow;
  busy: boolean;
  journeyIds: string[];
  stepLabel: (stepId: string) => string;
  loadPreview: (stepId: string) => Promise<Result<{ request: Preview }>>;
  onExpectedStatuses: (stepId: string, codes: string[]) => void;
  onRemoveOperation: (operationKey: string) => void;
  onStepOrder: (journeyId: string, stepIds: string[]) => void;
  onJourneyOrder: (journeyIds: string[]) => void;
}>) {
  const { journey, journeyIndex, step, stepIndex } = row;
  const stepIds = journey.steps.map((candidate) => candidate.id);
  const effect = writeEffectLabelOf(step.method);
  const variables = variablesFor(step);
  const note = choiceNote(step);
  return (
    <section
      aria-label={`Details for ${step.operationKey}`}
      className="space-y-3 rounded-md border border-border bg-chrome p-4 dark:bg-white/5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">
          J{journeyIndex + 1}.{stepIndex + 1}
        </span>
        <HttpMethodBadge method={step.method} />
        <h3 className="font-mono text-sm font-semibold">{step.path}</h3>
        {effect && <StatusBadge label={effect} tone="warning" />}
        {step.dependency && (
          <StatusBadge
            label={`${step.dependency.confidence} dependency`}
            tone="success"
          />
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Select an operation to inspect its generated request and configuration.
          </p>
          {note && <p className="text-xs text-muted">{note}</p>}
          <StepRequestPreview
            stepId={step.id}
            operationKey={step.operationKey}
            stepLabel={stepLabel}
            loadPreview={loadPreview}
          />
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Expected status</p>
            <ExpectedStatusEditor
              step={step}
              disabled={busy}
              onChange={(codes) => onExpectedStatuses(step.id, codes)}
            />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted">Authentication</dt>
              <dd className="mt-1">
                {AUTH_LABEL[step.auth.kind]}
                {step.auth.schemeName && ` · ${step.auth.schemeName}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Variables</dt>
              <dd className="mt-1">
                {variables.length > 0 ? variables.join(", ") : "None"}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-t border-border pt-3">
        <button
          type="button"
          className={ROW_ACTION}
          disabled={busy || stepIndex === 0}
          aria-label={`Move ${step.operationKey} up`}
          onClick={() => onStepOrder(journey.id, move(stepIds, stepIndex, -1))}
        >
          Move step up
        </button>
        <button
          type="button"
          className={ROW_ACTION}
          disabled={busy || stepIndex === journey.steps.length - 1}
          aria-label={`Move ${step.operationKey} down`}
          onClick={() => onStepOrder(journey.id, move(stepIds, stepIndex, 1))}
        >
          Move step down
        </button>
        <button
          type="button"
          className={ROW_ACTION}
          disabled={busy || journeyIndex === 0}
          aria-label={`Move journey ${journeyIndex + 1} up`}
          onClick={() => onJourneyOrder(move(journeyIds, journeyIndex, -1))}
        >
          Move journey up
        </button>
        <button
          type="button"
          className={ROW_ACTION}
          disabled={busy || journeyIndex === journeyIds.length - 1}
          aria-label={`Move journey ${journeyIndex + 1} down`}
          onClick={() => onJourneyOrder(move(journeyIds, journeyIndex, 1))}
        >
          Move journey down
        </button>
        <button
          type="button"
          className={BUTTON_STYLES.ghost}
          disabled={busy}
          onClick={() => onRemoveOperation(step.operationKey)}
        >
          Remove operation
        </button>
      </div>
    </section>
  );
}
