import { useState } from "react";
import type { PreviewReference, PreviewValue, StepRequestPreview as Preview } from "@apipilot/shared-domain";
import type { Result } from "../../services/performanceTestingClient";
import { CodeBlock } from "../CodeBlock";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";

/**
 * The view-only request one step sends (AP-032 FR-008, specs/032-quick-performance-test research
 * Q8), in a disclosure loaded on first open. Values from the environment are shown by name only:
 * the preview route never reads an environment, so no value can reach this component.
 */
type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; request: Preview };

function referenceText(reference: PreviewReference, stepLabel: (stepId: string) => string): string {
  switch (reference.kind) {
    case "environment":
      return `from environment: ${reference.name}`;
    case "workflow-variable":
      return reference.producerStepId ? `from step ${stepLabel(reference.producerStepId)}` : `from variable ${reference.variable}`;
    case "unique-per-iteration":
      return `unique per virtual user and iteration (${reference.format})`;
    case "credential":
      return `token acquired by the plan (${reference.schemeName})`;
  }
}

function ReferenceNote({ reference, stepLabel }: Readonly<{ reference: PreviewReference; stepLabel: (stepId: string) => string }>) {
  return (
    <span className="text-xs text-muted">
      {referenceText(reference, stepLabel)}
      {reference.kind === "environment" && reference.secret && (
        <>
          {" "}
          <StatusBadge label="secret" />
        </>
      )}
    </span>
  );
}

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
}: Readonly<{
  stepId: string;
  operationKey: string;
  stepLabel: (stepId: string) => string;
  loadPreview: (stepId: string) => Promise<Result<{ request: Preview }>>;
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
            <p className="text-muted">View only. Secret values are never shown.</p>
          </>
        )}
      </div>
    </div>
  );
}
