import { useState } from "react";
import { writeEffectLabelOf, type PerformanceJourney, type PerformanceStep, type StepRequestPreview as Preview } from "@apipilot/shared-domain";
import type { Result } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { AUTH_LABEL, choiceNote } from "./performanceViewModel";
import { StepRequestPreview } from "./StepRequestPreview";

/**
 * The plan's journeys and steps (FR-004 to FR-007, FR-012, FR-039). Reorder and removal requests go
 * to the server, which decides whether an order is valid (FR-007): this list never reorders on its
 * own, so a rejected move leaves the order on screen unchanged.
 */
const ROW_ACTION =
  "rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-white/10";

const EXPECTED_STATUS_HINT_ID = "performance-expected-status-hint";

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
}: Readonly<{ step: PerformanceStep; disabled: boolean; onChange: (codes: string[]) => void }>) {
  const [draft, setDraft] = useState("");
  const codes = step.expectedStatuses.map((status) => status.code);
  const inputId = `expected-${step.id}`;
  const add = () => {
    const code = draft.trim().toUpperCase();
    if (code.length === 0) return;
    setDraft("");
    onChange([...codes, code]);
  };
  return (
    <div className="space-y-1.5">
      {step.expectedStatuses.length === 0 && (
        <p className="text-xs font-semibold text-warning-700 dark:text-warning-100">
          The specification documents no success status. Set at least one.
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5" aria-label={`Expected status codes for ${step.operationKey}`}>
        {step.expectedStatuses.map((status) => (
          <li key={status.code} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-500/15">
            <span className="font-mono font-semibold">{status.code}</span>
            <span className="text-muted">· {status.source === "specification" ? "from specification" : "set by you"}</span>
            {codes.length > 1 && (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove expected status ${status.code} from ${step.operationKey}`}
                onClick={() => onChange(codes.filter((code) => code !== status.code))}
                className="rounded px-0.5 text-muted hover:text-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                ✕
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
          className="w-24 shrink-0 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        <button type="button" disabled={disabled || draft.trim().length === 0} onClick={add} className={ROW_ACTION}>
          Add
        </button>
      </div>
    </div>
  );
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
}: Readonly<{
  journeys: PerformanceJourney[];
  busy: boolean;
  announcement: string;
  /** AP-032 FR-008: the step request preview, loaded on first open. */
  loadPreview: (stepId: string) => Promise<Result<{ request: Preview }>>;
  onExpectedStatuses: (stepId: string, codes: string[]) => void;
  onRemoveOperation: (operationKey: string) => void;
  onStepOrder: (journeyId: string, stepIds: string[]) => void;
  onJourneyOrder: (journeyIds: string[]) => void;
}>) {
  const journeyIds = journeys.map((journey) => journey.id);
  const stepLabel = (stepId: string) =>
    journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.id === stepId)?.operationKey ?? stepId;
  return (
    <div className="space-y-5">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p id={EXPECTED_STATUS_HINT_ID} className="text-xs text-muted">
        Expected status: a response with any other status counts as a failure. Add an exact code such as 201, or a
        range such as 2XX for any 2xx.
      </p>
      {journeys.map((journey, journeyIndex) => {
        const label = journey.source.kind === "workflow" ? "Workflow journey" : "Single operation";
        const needsStatus = journey.steps.some((step) => step.expectedStatuses.length === 0);
        const confidence = journey.steps.find((step) => step.dependency)?.dependency?.confidence;
        return (
          <section key={journey.id} aria-label={`Journey ${journeyIndex + 1}: ${label}`} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted">J{journeyIndex + 1}</span>
              <h3 className="text-sm font-semibold">{label}</h3>
              {confidence && <StatusBadge label={`${confidence} dependency`} tone="success" />}
              {needsStatus && <StatusBadge label="Needs an expected status" tone="warning" />}
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  className={ROW_ACTION}
                  disabled={busy || journeyIndex === 0}
                  aria-label={`Move journey ${journeyIndex + 1} up`}
                  onClick={() => onJourneyOrder(move(journeyIds, journeyIndex, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={ROW_ACTION}
                  disabled={busy || journeyIndex === journeys.length - 1}
                  aria-label={`Move journey ${journeyIndex + 1} down`}
                  onClick={() => onJourneyOrder(move(journeyIds, journeyIndex, 1))}
                >
                  ↓
                </button>
              </span>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-chrome text-left text-xs text-muted">
                    <th scope="col" className="w-8 px-3 py-2 font-semibold">#</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Request</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Scenario</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Expected status</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Auth</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Variables</th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {journey.steps.map((step, stepIndex) => {
                    const stepIds = journey.steps.map((candidate) => candidate.id);
                    const rowTone = step.expectedStatuses.length === 0 ? "bg-warning-50 dark:bg-warning-500/10" : "";
                    const note = choiceNote(step);
                    const effect = writeEffectLabelOf(step.method);
                    return (
                      <tr key={step.id} className={`border-t border-border align-top ${rowTone}`}>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted">{stepIndex + 1}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <HttpMethodBadge method={step.method} />
                            {effect && <StatusBadge label={effect} tone="warning" />}
                            <span className="font-mono text-xs">{step.path}</span>
                          </div>
                          <StepRequestPreview stepId={step.id} operationKey={step.operationKey} stepLabel={stepLabel} loadPreview={loadPreview} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div>{step.scenarioDescription}</div>
                          {note && <div className="text-xs text-muted">{note}</div>}
                        </td>
                        <td className="px-3 py-2.5">
                          <ExpectedStatusEditor step={step} disabled={busy} onChange={(codes) => onExpectedStatuses(step.id, codes)} />
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {AUTH_LABEL[step.auth.kind]}
                          {step.auth.schemeName && <div className="text-muted">{step.auth.schemeName}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {step.variableBindings.length === 0 && step.requiredValues.length <= 1 && <span className="text-muted">—</span>}
                          {step.variableBindings.map((binding) => (
                            <div key={`${binding.role}-${binding.variable}`}>
                              {binding.role} <span className="font-mono">{binding.variable}</span>
                            </div>
                          ))}
                          {step.requiredValues
                            .filter((name) => name !== "baseUrl")
                            .map((name) => (
                              <div key={name} className="text-muted">
                                needs <span className="font-mono">{name}</span>
                              </div>
                            ))}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              className={ROW_ACTION}
                              disabled={busy || stepIndex === 0}
                              aria-label={`Move ${step.operationKey} up`}
                              onClick={() => onStepOrder(journey.id, move(stepIds, stepIndex, -1))}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className={ROW_ACTION}
                              disabled={busy || stepIndex === journey.steps.length - 1}
                              aria-label={`Move ${step.operationKey} down`}
                              onClick={() => onStepOrder(journey.id, move(stepIds, stepIndex, 1))}
                            >
                              ↓
                            </button>
                            <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => onRemoveOperation(step.operationKey)}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
