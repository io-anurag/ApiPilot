import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { AUTH_LABEL, AUTH_SHORT_LABEL, choiceNote } from "./performanceViewModel";
import { StepRequestPreview } from "./StepRequestPreview";
import { WrappingPath } from "./WrappingPath";

/**
 * The plan's steps as one compact table (AP-029 FR-006 to FR-012a, AP-032 FR-008, FR-010, FR-014):
 * one line per step, filterable by method, by write operations and by steps still needing an
 * expected status. A step's request, expected-status editor, ordering and removal open in a row
 * directly under it, so what is being edited stays next to the row it belongs to. Workflow
 * journeys of more than one step get a group row so their order reads as one unit.
 */
const PAGE_SIZE = 50;
const ROW_ACTION =
  "rounded border border-border bg-surface px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-white/10";
const CHIP =
  "rounded-full border px-2.5 py-1 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
const CHIP_ON = "border-brand-600 bg-brand-600 text-white hover:bg-brand-700";
const CHIP_OFF = "border-border bg-surface text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/10";
const EXPECTED_STATUS_HINT_ID = "performance-expected-status-hint";
const WRITES = "WRITES";
const ALL = "ALL";

/** Asks the list to open a step and focus its expected-status editor; `nonce` repeats a request. */
export interface FocusRequest {
  readonly stepId: string;
  readonly nonce: number;
}

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

function isGroupedJourney(journey: PerformanceJourney): boolean {
  return journey.source.kind === "workflow" || journey.steps.length > 1;
}

function rowLabel({ journey, journeyIndex, stepIndex }: InventoryRow): string {
  return isGroupedJourney(journey) ? `J${journeyIndex + 1}.${stepIndex + 1}` : `J${journeyIndex + 1}`;
}

function environmentValuesOf(step: PerformanceStep): string[] {
  return step.requiredValues.filter((name) => name !== "baseUrl");
}

function variablesFor(step: PerformanceStep): string[] {
  return [
    ...step.variableBindings.map((binding) => `${binding.role} ${binding.variable}`),
    ...environmentValuesOf(step).map((name) => `needs ${name}`),
  ];
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
      <ul className="flex flex-wrap gap-1.5" aria-label={`Expected status codes for ${step.operationKey}`}>
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
        <button type="button" disabled={disabled || !draft.trim()} onClick={add} className={ROW_ACTION}>
          Add
        </button>
      </div>
      <p id={EXPECTED_STATUS_HINT_ID} className="text-xs text-muted">
        Expected status: a response with any other status counts as a failure. Add an exact code
        such as 201, or a range such as 2XX for any 2xx.
      </p>
    </div>
  );
}

function RemoveByMethodMenu({
  methods,
  busy,
  onRemoveMethod,
}: Readonly<{
  methods: readonly string[];
  busy: boolean;
  onRemoveMethod: (method: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div
      ref={container}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls="performance-remove-by-method"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        className={ROW_ACTION}
      >
        Remove by method <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id="performance-remove-by-method"
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {methods.map((method) => (
            <button
              key={method}
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onRemoveMethod(method);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
            >
              Remove all {method} operations
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function JourneyList({
  journeys,
  busy,
  announcement,
  onExpectedStatuses,
  onRemoveOperations,
  onRemoveMethod,
  onStepOrder,
  onJourneyOrder,
  loadPreview,
  focusRequest,
}: Readonly<{
  journeys: PerformanceJourney[];
  busy: boolean;
  announcement: string;
  loadPreview: (stepId: string) => Promise<Result<{ request: Preview }>>;
  onExpectedStatuses: (stepId: string, codes: string[]) => void;
  onRemoveOperations: (operationKeys: string[], success: string) => void;
  onRemoveMethod: (method: string) => void;
  onStepOrder: (journeyId: string, stepIds: string[]) => void;
  onJourneyOrder: (journeyIds: string[]) => void;
  focusRequest: FocusRequest | null;
}>) {
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState(ALL);
  const [needsStatusOnly, setNeedsStatusOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const handledFocus = useRef<number | null>(null);

  // A focus request clears the filters and turns to the step's page, so its row is on screen.
  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest.nonce) return;
    handledFocus.current = focusRequest.nonce;
    const index = journeys
      .flatMap((journey) => journey.steps)
      .findIndex((step) => step.id === focusRequest.stepId);
    setQuery("");
    setMethodFilter(ALL);
    setNeedsStatusOnly(false);
    setPage(Math.max(0, Math.floor(index / PAGE_SIZE)));
    setExpandedStepId(focusRequest.stepId);
    setPendingFocus(focusRequest.stepId);
  }, [focusRequest, journeys]);
  useEffect(() => {
    if (!pendingFocus) return;
    const input = document.getElementById(`expected-${pendingFocus}`);
    if (input) {
      input.focus();
      setPendingFocus(null);
    }
  });

  const rows: InventoryRow[] = journeys.flatMap((journey, journeyIndex) =>
    journey.steps.map((step, stepIndex) => ({ journey, journeyIndex, step, stepIndex })),
  );
  const methodCounts = new Map<string, number>();
  for (const { step } of rows) {
    const method = step.method.toUpperCase();
    methodCounts.set(method, (methodCounts.get(method) ?? 0) + 1);
  }
  const methods = [...methodCounts.keys()].sort((a, b) => a.localeCompare(b));
  const writeCount = rows.filter(({ step }) => writeEffectLabelOf(step.method)).length;
  const needsStatusCount = rows.filter(({ step }) => step.expectedStatuses.length === 0).length;
  const filteredRows = rows.filter(({ step }) => {
    const method = step.method.toUpperCase();
    const matchesMethod =
      methodFilter === ALL ||
      (methodFilter === WRITES ? writeEffectLabelOf(method) !== null : method === methodFilter);
    const text = `${step.method} ${step.path} ${step.operationKey} ${step.scenarioDescription}`.toLowerCase();
    return (
      matchesMethod &&
      (!needsStatusOnly || step.expectedStatuses.length === 0) &&
      text.includes(query.toLowerCase())
    );
  });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = filteredRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const journeyIds = journeys.map((journey) => journey.id);
  const stepLabel = (stepId: string) =>
    rows.find(({ step }) => step.id === stepId)?.step.operationKey ?? stepId;
  const presentKeys = new Set(rows.map(({ step }) => step.operationKey));
  const selectedKeys = [...selected].filter((key) => presentKeys.has(key));
  const visibleKeys = [...new Set(visibleRows.map(({ step }) => step.operationKey))];
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const someVisibleSelected = visibleKeys.some((key) => selected.has(key));

  const resetPage = () => setPage(0);
  const toggleSelected = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const setVisibleSelected = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const key of visibleKeys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const openForStatus = (stepId: string) => {
    setExpandedStepId(stepId);
    setPendingFocus(stepId);
  };

  const methodChips: { id: string; label: string; count: number }[] = [
    { id: ALL, label: "All", count: rows.length },
    ...methods.map((method) => ({ id: method, label: method, count: methodCounts.get(method) ?? 0 })),
    ...(writeCount > 0 ? [{ id: WRITES, label: "Writes", count: writeCount }] : []),
  ];

  const body: ReactNode[] = [];
  let previousJourneyId: string | null = null;
  for (const row of visibleRows) {
    const { journey, journeyIndex, step } = row;
    if (isGroupedJourney(journey) && journey.id !== previousJourneyId) {
      body.push(
        <tr key={`group-${journey.id}`} className="border-t border-border bg-chrome dark:bg-white/5">
          <td className="px-3 py-1.5" />
          <th scope="colgroup" colSpan={5} className="px-2 py-1.5 text-left text-xs font-normal">
            <span className="font-mono font-semibold">J{journeyIndex + 1}</span>{" "}
            <span className="font-semibold">Workflow</span>{" "}
            <span className="text-muted">
              · {journey.steps.length} step{journey.steps.length === 1 ? "" : "s"}, run in this order
            </span>
          </th>
        </tr>,
      );
    }
    previousJourneyId = journey.id;
    const expanded = expandedStepId === step.id;
    const effect = writeEffectLabelOf(step.method);
    const needsStatus = step.expectedStatuses.length === 0;
    const values = environmentValuesOf(step);
    let rowTone = "hover:bg-slate-50 dark:hover:bg-white/5";
    if (expanded) rowTone = "bg-brand-50 dark:bg-brand-500/10";
    else if (needsStatus) rowTone = "bg-warning-50 hover:bg-warning-100 dark:bg-warning-500/5 dark:hover:bg-warning-500/10";
    body.push(
      <tr key={step.id} className={`border-t border-border ${rowTone}`}>
        <td className="px-3 py-1.5">
          <input
            type="checkbox"
            checked={selected.has(step.operationKey)}
            onChange={(event) => toggleSelected(step.operationKey, event.target.checked)}
            aria-label={`Select ${step.operationKey}`}
            className="accent-brand-600"
          />
        </td>
        <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap text-muted">{rowLabel(row)}</td>
        <td className="px-2 py-1.5">
          <button
            type="button"
            onClick={() => setExpandedStepId(expanded ? null : step.id)}
            aria-expanded={expanded}
            aria-controls={expanded ? `performance-step-details-${step.id}` : undefined}
            aria-label={`Details of ${step.operationKey}`}
            className={`flex w-full items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${isGroupedJourney(journey) ? "pl-3" : ""}`}
          >
            <span aria-hidden="true" className="w-3 shrink-0 text-xs text-muted">
              {expanded ? "▾" : "▸"}
            </span>
            <HttpMethodBadge method={step.method} />
            <WrappingPath path={step.path} />
            {effect && <StatusBadge label={effect} tone="warning" />}
          </button>
        </td>
        <td className="px-2 py-1.5 whitespace-nowrap">
          {needsStatus ? (
            <button
              type="button"
              onClick={() => openForStatus(step.id)}
              aria-label={`Set the expected status of ${step.operationKey}`}
              className="rounded-full border border-warning-500 bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700 hover:bg-warning-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-500 dark:bg-warning-500/10 dark:text-warning-100"
            >
              Needs status · Set
            </button>
          ) : (
            <span className="font-mono text-xs">
              {step.expectedStatuses.map((status) => status.code).join(", ")}
            </span>
          )}
        </td>
        {/* `relative` keeps the absolutely positioned sr-only label inside the scrolling table. */}
        <td className="relative px-2 py-1.5 text-xs whitespace-nowrap">
          <span aria-hidden="true">{AUTH_SHORT_LABEL[step.auth.kind]}</span>
          <span className="sr-only">{AUTH_LABEL[step.auth.kind]}</span>
        </td>
        <td className="px-2 py-1.5">
          {values.length > 0 ? (
            <span className="flex max-w-56 flex-wrap gap-1">
              {values.map((name) => (
                <span key={name} className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-white/10">
                  {name}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-xs text-muted">None</span>
          )}
        </td>
      </tr>,
    );
    if (expanded) {
      body.push(
        <tr key={`${step.id}-details`} id={`performance-step-details-${step.id}`}>
          <td colSpan={6} className="border-t border-border bg-chrome px-4 py-4 dark:bg-white/5">
            <OperationInspector
              row={row}
              busy={busy}
              journeyIds={journeyIds}
              stepLabel={stepLabel}
              loadPreview={loadPreview}
              onExpectedStatuses={onExpectedStatuses}
              onRemoveOperation={(operationKey) =>
                onRemoveOperations([operationKey], `${operationKey} removed from the plan.`)
              }
              onStepOrder={onStepOrder}
              onJourneyOrder={onJourneyOrder}
            />
          </td>
        </tr>,
      );
    }
  }

  return (
    <div className="space-y-3">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-52 flex-1">
          <span className="sr-only">Search operations in the performance plan</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetPage();
            }}
            placeholder="Search method, path, or scenario"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100"
          />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter operations by method">
          {methodChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={methodFilter === chip.id}
              onClick={() => {
                setMethodFilter(chip.id);
                resetPage();
              }}
              className={`${CHIP} ${methodFilter === chip.id ? CHIP_ON : CHIP_OFF}`}
            >
              {chip.label} <span className="opacity-70">{chip.count}</span>
            </button>
          ))}
        </div>
        {needsStatusCount > 0 && (
          <button
            type="button"
            aria-pressed={needsStatusOnly}
            onClick={() => {
              setNeedsStatusOnly((current) => !current);
              resetPage();
            }}
            className={`rounded-full border border-warning-500 px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-500 ${needsStatusOnly ? "bg-warning-600 text-white" : "bg-warning-50 text-warning-700 hover:bg-warning-100 dark:bg-warning-500/10 dark:text-warning-100"}`}
          >
            Needs expected status · {needsStatusCount}
          </button>
        )}
        <div className="ml-auto">
          <RemoveByMethodMenu methods={methods} busy={busy} onRemoveMethod={onRemoveMethod} />
        </div>
      </div>

      {selectedKeys.length > 0 && (
        <section
          aria-label="Selected operations"
          className="flex flex-wrap items-center gap-3 rounded-md border border-brand-500 bg-brand-50 px-3 py-2 text-sm dark:bg-brand-500/10"
        >
          <span className="font-medium">
            {selectedKeys.length} operation{selectedKeys.length === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            className={BUTTON_STYLES.secondary}
            disabled={busy}
            onClick={() => {
              onRemoveOperations(
                selectedKeys,
                `${selectedKeys.length} operation${selectedKeys.length === 1 ? "" : "s"} removed.`,
              );
              setSelected(new Set());
            }}
          >
            Remove from plan
          </button>
          <button type="button" className={`${BUTTON_STYLES.ghost} ml-auto`} onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </section>
      )}

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table aria-label="Performance plan operations" className="w-full min-w-180 border-collapse text-sm">
          <thead className="bg-chrome text-left text-xs text-muted dark:bg-white/5">
            <tr>
              <th scope="col" className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select every operation shown"
                  checked={allVisibleSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected;
                  }}
                  onChange={(event) => setVisibleSelected(event.target.checked)}
                  className="accent-brand-600"
                />
              </th>
              <th scope="col" className="w-14 px-2 py-2 font-semibold">
                Journey
              </th>
              <th scope="col" className="w-1/2 px-2 py-2 font-semibold">
                Request
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Expected status
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Auth
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Environment values
              </th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
        {visibleRows.length === 0 && (
          <p className="p-6 text-center text-sm text-muted">No operations match these filters.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {filteredRows.length} of {rows.length} step{rows.length === 1 ? "" : "s"} shown
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={ROW_ACTION}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
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
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
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
  const variables = variablesFor(step);
  const note = choiceNote(step);
  return (
    <section aria-label={`Details for ${step.operationKey}`} className="space-y-3">
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-2 lg:col-span-3">
          <p className="text-sm">
            <span className="text-xs font-medium text-muted">Scenario</span>{" "}
            <span>{step.scenarioDescription}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {note && <span className="text-xs text-muted">{note}</span>}
            {step.dependency && (
              <StatusBadge label={`${step.dependency.confidence} dependency`} tone="success" />
            )}
          </div>
          <StepRequestPreview
            stepId={step.id}
            operationKey={step.operationKey}
            stepLabel={stepLabel}
            loadPreview={loadPreview}
          />
        </div>
        <div className="space-y-3 text-sm lg:col-span-2">
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
              <dd className="mt-1">{variables.length > 0 ? variables.join(", ") : "None"}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        {journey.steps.length > 1 && (
          <>
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
          </>
        )}
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
          disabled={busy}
          onClick={() => onRemoveOperation(step.operationKey)}
          className="ml-auto rounded border border-danger-500 px-2 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-danger-100 dark:hover:bg-danger-500/10"
        >
          Remove from plan
        </button>
      </div>
    </section>
  );
}
