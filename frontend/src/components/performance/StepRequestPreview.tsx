import { useState } from "react";
import type { BodyEditInput, ParameterEditInput, PreviewValue, StepBodyStatus, StepRequestPreview as Preview } from "@apipilot/shared-domain";
import type { PerformanceErrorResult, Result } from "../../services/performanceTestingClient";
import { CodeBlock } from "../CodeBlock";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Skeleton } from "../Skeleton";
import { ReferenceNote } from "./PreviewReferenceNote";
import { StepBodyEditor } from "./StepBodyEditor";
import { StepParameterEditor } from "./StepParameterEditor";

/**
 * The view-only request one step sends (AP-032 FR-008, specs/032-quick-performance-test research
 * Q8), in a disclosure loaded on first open. Values from the environment are shown by name only:
 * the preview route never reads an environment, so no value can reach this component.
 */
type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; request: Preview };

/** AP-033 FR-001: a step without a body says so in words, so an empty area is never mistaken for a failure. */
const BODY_STATUS_TEXT: Record<StepBodyStatus, string | null> = {
  sent: null,
  "not-documented": "This request has no body.",
  "documented-not-sent": "This operation accepts a body that this step does not send.",
  "unsupported-content-type": "Form and multipart bodies are shown but cannot be edited.",
};

function ValueCell({ value, stepLabel }: Readonly<{ value: PreviewValue; stepLabel: (stepId: string) => string }>) {
  if (value.kind === "generated") return <span className="break-all font-mono text-xs">{value.text}</span>;
  if (value.kind === "template") {
    return (
      <div className="space-y-0.5">
        <span className="break-all font-mono text-xs">{value.text}</span>
        {value.references.map((reference) => (
          <div key={reference.name}>
            <span className="font-mono text-xs">{reference.name}</span>: <ReferenceNote reference={reference} stepLabel={stepLabel} />
          </div>
        ))}
      </div>
    );
  }
  return <ReferenceNote reference={value} stepLabel={stepLabel} />;
}

export function StepRequestPreview({
  stepId,
  operationKey,
  stepLabel,
  loadPreview,
  onSaveBody,
  onSaveParameters,
  busy = false,
}: Readonly<{
  stepId: string;
  operationKey: string;
  stepLabel: (stepId: string) => string;
  loadPreview: (stepId: string) => Promise<Result<{ request: Preview }>>;
  /**
   * AP-033: present for a step in the plan, so its body can be edited (FR-003). Left out for a
   * removed operation's read-only preview. Resolves to `null` when saved, or to the refusal.
   */
  onSaveBody?: (stepId: string, input: BodyEditInput | null) => Promise<PerformanceErrorResult | null>;
  /** AP-033 FR-020 (amended 2026-09-30): present for a step in the plan, so its parameters can be edited. */
  onSaveParameters?: (stepId: string, input: ParameterEditInput | null) => Promise<PerformanceErrorResult | null>;
  busy?: boolean;
}>) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const panelId = `request-preview-${stepId}`;

  async function load() {
    setState({ kind: "loading" });
    const result = await loadPreview(stepId);
    setState(result.ok ? { kind: "ready", request: result.request } : { kind: "error", message: result.message });
  }

  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
          if (!open && state.kind === "idle") void load();
        }}
        className="text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300"
      >
        Request
      </button>
      <div id={panelId} hidden={!open} className="mt-2 max-w-3xl space-y-2 whitespace-normal">
        {state.kind === "loading" && <Skeleton className="h-16 w-full rounded bg-slate-200 dark:bg-slate-600" />}
        {state.kind === "error" && <ErrorState message={state.message} testId="step-request-preview-error" />}
        {state.kind === "ready" && (
          <>
            <div className="flex items-center gap-2">
              <HttpMethodBadge method={state.request.method} />
              <span className="font-mono">{state.request.pathTemplate}</span>
            </div>
            {state.request.parameters.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <caption className="sr-only">Request parameters for {operationKey}</caption>
                  <thead>
                    <tr className="bg-chrome text-left text-muted">
                      <th scope="col" className="px-2 py-1 font-semibold">Parameter</th>
                      <th scope="col" className="px-2 py-1 font-semibold">In</th>
                      <th scope="col" className="px-2 py-1 font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.request.parameters.map((parameter) => (
                      <tr key={`${parameter.location}-${parameter.name}`} className="border-t border-border align-top">
                        <td className="px-2 py-1 font-mono">{parameter.name}</td>
                        <td className="px-2 py-1">{parameter.location}</td>
                        <td className="px-2 py-1">
                          <ValueCell value={parameter.value} stepLabel={stepLabel} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {onSaveParameters && state.request.parameterEdit && (
              <StepParameterEditor
                key={JSON.stringify(state.request.parameterEdit.rows.map((row) => row.edit))}
                operationKey={operationKey}
                model={state.request.parameterEdit}
                busy={busy}
                onSave={async (input) => {
                  const refusal = await onSaveParameters(stepId, input);
                  if (!refusal) void load();
                  return refusal;
                }}
              />
            )}
            {state.request.auth.location && (
              <p>
                <span className="font-semibold">Auth</span> ({state.request.auth.location}
                {state.request.auth.schemeName ? `, ${state.request.auth.schemeName}` : ""}):{" "}
                {state.request.auth.references.map((reference) => (
                  <span key={reference.name} className="mr-2">
                    <span className="font-mono">{reference.name}</span> <ReferenceNote reference={reference} stepLabel={stepLabel} />
                  </span>
                ))}
              </p>
            )}
            {state.request.body && (
              <div className="space-y-1">
                <CodeBlock label={`Body (${state.request.body.contentType})`} content={state.request.body.text} />
                {state.request.body.references.map((reference) => (
                  <div key={reference.name}>
                    <span className="font-mono">{reference.name}</span>: <ReferenceNote reference={reference} stepLabel={stepLabel} />
                  </div>
                ))}
              </div>
            )}
            {BODY_STATUS_TEXT[state.request.bodyStatus] && <p className="text-muted">{BODY_STATUS_TEXT[state.request.bodyStatus]}</p>}
            {onSaveBody && state.request.bodyEdit && (
              <StepBodyEditor
                key={`${state.request.bodyEdit.edited}-${state.request.bodyEdit.text}`}
                stepId={stepId}
                operationKey={operationKey}
                model={state.request.bodyEdit}
                stepLabel={stepLabel}
                busy={busy}
                onSave={async (input) => {
                  const refusal = await onSaveBody(stepId, input);
                  if (!refusal) void load();
                  return refusal;
                }}
                onReset={async () => {
                  const refusal = await onSaveBody(stepId, null);
                  if (!refusal) void load();
                  return refusal;
                }}
              />
            )}
            <p className="text-muted">
              {onSaveBody || onSaveParameters ? "Authentication and undocumented headers are view only." : "View only."} Secret values are never shown.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
