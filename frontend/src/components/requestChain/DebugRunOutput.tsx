import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type {
  DebugBody,
  DebugCheckOutcome,
  DebugChainOutcome,
  DebugExtractorFailure,
  DebugExtractorOutcome,
  DebugHeader,
  DebugNoResponseReason,
  DebugRunOutcome,
  DebugRunResult,
  DebugSentStep,
  DebugSkipCause,
  DebugStepOutcome,
  MaskedText,
} from "@apipilot/shared-domain";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge, type StatusTone } from "../StatusBadge";

/**
 * The output of a Debug run (specs/039-chain-debug-run US1 to US3): one section per chain, one card
 * per step with the request that went out, the response that came back, each extractor's and check's
 * outcome, and, for a step that was not sent, why. Every piece of text arrives already masked by the
 * server (`MaskedText`); this component only draws it. A masked value that came from the target can
 * be revealed one at a time through `onReveal`; the revealed text lives in this component's state and
 * nowhere else, so closing or reloading masks it again (FR-015a). A secret the engineer supplied has
 * no control, because the server never sent it (FR-015b). Outcomes use words as well as colour.
 */

export type RevealValue = (valueId: string) => Promise<string | null>;

interface RevealState {
  revealed: ReadonlyMap<string, string>;
  unavailable: ReadonlySet<string>;
  reveal: (valueId: string) => void;
  hide: (valueId: string) => void;
}

const RevealContext = createContext<RevealState | null>(null);

const OUTCOME: Record<DebugRunOutcome, { text: string; tone: StatusTone }> = {
  completed: { text: "Completed", tone: "success" },
  "stopped-early": { text: "Stopped early", tone: "warning" },
  "setup-failed": { text: "A Once before load step failed", tone: "danger" },
  "cut-off": { text: "Cut off at the time limit", tone: "warning" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

const NO_RESPONSE: Record<DebugNoResponseReason, string> = {
  refused: "The target refused the connection.",
  timeout: "The request timed out.",
  dns: "The host name could not be found.",
  aborted: "The request was cancelled.",
  "unsupported-request": "A Debug run cannot send a body with a GET or HEAD request.",
  error: "The request could not be sent.",
};

const STOP_REASON = {
  "extractor-failed": "a value it should extract was not found",
  "unexpected-status": "it returned an unexpected status",
  "setup-failed": "a Once before load step failed",
} as const;

export function skipText(cause: DebugSkipCause): string {
  switch (cause.kind) {
    case "stopped-by":
      return `Not sent: the chain stopped at "${cause.stepName}" because ${STOP_REASON[cause.reason]}.`;
    case "missing-value":
      return `Not sent: there is no value for ${cause.names.join(", ")}. Add it to the environment.`;
    case "missing-extracted":
      return `Not sent: ${cause.names.join(", ")} was not extracted by an earlier step.`;
    case "host-not-allowed":
      return `Not sent: the address resolves to ${cause.host}, which is not an allowed host.`;
    case "not-reached":
      return cause.reason === "run-cancelled" ? "Not sent: the run was cancelled." : "Not sent: the run reached its time limit.";
  }
}

export function extractorFailureText(reason: DebugExtractorFailure): string {
  switch (reason.code) {
    case "not-extracted-status":
      return "Not attempted: the response status was not one of the expected statuses.";
    case "body-not-json":
      return `The response body is not JSON (${reason.contentType ? `content type ${reason.contentType}` : "no content type"}).`;
    case "path-not-found":
      return `Field ${reason.path} was not found in the response body. Compare it with the field names in the response above.`;
    case "value-not-scalar":
      return reason.found === "empty-text" ? "The value found is empty text." : `The value found is ${reason.found === "null" ? "null" : `an ${reason.found}`}, not a single text, number or boolean.`;
    case "header-missing":
      return `The response has no ${reason.header} header.`;
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Text with each masked piece drawn as a marker, and a reveal control where the server allows one. */
function Masked({ text }: Readonly<{ text: MaskedText }>) {
  const state = useContext(RevealContext);
  return (
    <>
      {text.map((segment, index) => {
        if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
        const value = state?.revealed.get(segment.valueId);
        if (value !== undefined) {
          return (
            <span key={index} className="rounded bg-warning-100 px-1 text-warning-700 dark:bg-warning-500/20 dark:text-warning-100" data-testid="revealed-value">
              {value}{" "}
              <button type="button" className="text-xs underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={() => state?.hide(segment.valueId)} aria-label={`Hide ${segment.label}`}>
                Hide
              </button>
            </span>
          );
        }
        return (
          <span key={index} className="whitespace-nowrap">
            <span className="rounded bg-surface-strong px-1 text-text-secondary" data-testid="masked-value" title={segment.label}>
              ••••••<span className="sr-only"> masked: {segment.label}</span>
            </span>
            {segment.revealable && state && (
              <button
                type="button"
                className="ml-1 text-xs text-brand-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300"
                onClick={() => state.reveal(segment.valueId)}
                aria-label={`Reveal ${segment.label}`}
              >
                Reveal
              </button>
            )}
            {state?.unavailable.has(segment.valueId) && (
              <span className="ml-1 text-xs text-danger-700 dark:text-danger-100" role="status">
                No longer available. Run the Debug run again.
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

function BodyBlock({ body, label }: Readonly<{ body: DebugBody; label: string }>) {
  if (body.kind === "none") return <p className="text-xs text-muted">{label}: none.</p>;
  if (body.kind === "binary") return <p className="text-xs text-muted">{label}: binary content ({body.contentType ?? "unknown type"}, {formatBytes(body.sizeBytes)}) is not shown.</p>;
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-semibold uppercase text-muted">
        {label}
        {body.contentType ? <span className="ml-2 font-normal normal-case">{body.contentType}</span> : null}
      </p>
      <pre data-testid="debug-body" className="max-h-96 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md border border-border bg-code-surface p-3 font-mono text-xs text-code-text">
        <code>
          <Masked text={body.text} />
        </code>
      </pre>
      {body.truncated && <p className="text-xs text-muted">Shown in part: the full body is {formatBytes(body.sizeBytes)}.</p>}
    </div>
  );
}

function HeaderTable({ headers, label }: Readonly<{ headers: readonly DebugHeader[]; label: string }>) {
  if (headers.length === 0) return <p className="text-xs text-muted">{label}: none set.</p>;
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="sr-only">
            <tr>
              <th scope="col">Header</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {headers.map((header, index) => (
              <tr key={`${header.name}-${index}`}>
                <th scope="row" className="py-0.5 pr-3 align-top font-mono font-medium">
                  {header.name}
                </th>
                <td className="py-0.5 font-mono wrap-anywhere">
                  <Masked text={header.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExtractorTable({ extractors }: Readonly<{ extractors: readonly DebugExtractorOutcome[] }>) {
  if (extractors.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase text-muted">Extractors</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-0.5 pr-3 font-medium">Name</th>
              <th scope="col" className="py-0.5 pr-3 font-medium">Takes it from</th>
              <th scope="col" className="py-0.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {extractors.map((item) => (
              <tr key={item.extractorId}>
                <td className="py-1 pr-3 align-top font-mono">{item.name}</td>
                <td className="py-1 pr-3 align-top font-mono">{item.source.kind === "body" ? `body: ${item.source.path}` : `header: ${item.source.name}`}</td>
                <td className="py-1 align-top">
                  {item.outcome.kind === "extracted" ? (
                    <span>
                      <StatusBadge label="Extracted" tone="success" /> <span className="font-mono wrap-anywhere"><Masked text={item.outcome.value} /></span>
                    </span>
                  ) : (
                    <span>
                      <StatusBadge label="Failed" tone="danger" /> {extractorFailureText(item.outcome.reason)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CheckTable({ checks }: Readonly<{ checks: readonly DebugCheckOutcome[] }>) {
  if (checks.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase text-muted">Checks</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-0.5 pr-3 font-medium">Check</th>
              <th scope="col" className="py-0.5 pr-3 font-medium">Result</th>
              <th scope="col" className="py-0.5 font-medium">What was compared</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {checks.map((check) => (
              <tr key={check.checkId}>
                <td className="py-1 pr-3 align-top">{check.kind}</td>
                <td className="py-1 pr-3 align-top">
                  <StatusBadge label={check.passed ? "Passed" : "Failed"} tone={check.passed ? "success" : "danger"} />
                </td>
                <td className="py-1 align-top">{check.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stepFailed(step: DebugSentStep): boolean {
  return !step.statusOutcome.ok || step.response === null || step.extractors.some((item) => item.outcome.kind === "failed") || step.checks.some((check) => !check.passed);
}

function SentStep({ step }: Readonly<{ step: DebugSentStep }>) {
  const failed = stepFailed(step);
  const status = step.response ? `${step.response.status}${step.response.statusText ? ` ${step.response.statusText}` : ""}` : "No response";
  return (
    <li className="rounded-md border border-border bg-surface" data-testid="debug-step" data-status="sent">
      <details open={failed}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <HttpMethodBadge method={step.request.method} />
          <span className="font-medium">{step.stepName}</span>
          <StatusBadge label={status} tone={step.statusOutcome.ok ? "success" : "danger"} />
          <span className="text-xs text-muted">{step.durationMs} ms</span>
          {failed && <StatusBadge label="Needs attention" tone="warning" />}
        </summary>
        <div className="space-y-3 border-t border-border px-3 py-3">
          <p className="text-sm">
            <span className="text-xs font-semibold uppercase text-muted">Request</span>{" "}
            <code className="font-mono text-xs wrap-anywhere">
              {step.request.method} <Masked text={step.request.url} />
            </code>
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <HeaderTable headers={step.request.headers} label="Request headers" />
              <BodyBlock body={step.request.body} label="Request body" />
            </div>
            <div className="min-w-0 space-y-3">
              {step.response ? (
                <>
                  <p className="text-sm">
                    <span className="text-xs font-semibold uppercase text-muted">Response</span> {status}
                  </p>
                  {step.response.redirects.length > 0 && (
                    <div className="text-xs">
                      <p className="font-semibold uppercase text-muted">Redirects followed</p>
                      <ol className="list-decimal pl-5 font-mono wrap-anywhere">
                        {step.response.redirects.map((url, index) => (
                          <li key={index}>
                            <Masked text={url} />
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {step.response.redirectBlockedTo && (
                    <p className="text-xs text-danger-700 dark:text-danger-100" role="note">
                      A redirect to {step.response.redirectBlockedTo} was not followed: it is not an allowed host.
                    </p>
                  )}
                  <HeaderTable headers={step.response.headers} label="Response headers" />
                  <BodyBlock body={step.response.body} label="Response body" />
                </>
              ) : (
                <p className="text-sm" role="note">
                  <span className="text-xs font-semibold uppercase text-muted">Response</span> None. {step.noResponseReason ? NO_RESPONSE[step.noResponseReason] : ""}
                </p>
              )}
            </div>
          </div>
          <p className="text-sm">
            <span className="text-xs font-semibold uppercase text-muted">Status</span> Expected {step.statusOutcome.expected.join(", ")}; received {step.statusOutcome.received ?? "nothing"}.{" "}
            <StatusBadge label={step.statusOutcome.ok ? "As expected" : "Not expected"} tone={step.statusOutcome.ok ? "success" : "danger"} />
          </p>
          <ExtractorTable extractors={step.extractors} />
          <CheckTable checks={step.checks} />
        </div>
      </details>
    </li>
  );
}

function StepList({ steps }: Readonly<{ steps: readonly DebugStepOutcome[] }>) {
  return (
    <ol className="space-y-2">
      {steps.map((step) =>
        step.status === "sent" ? (
          <SentStep key={step.stepId} step={step} />
        ) : (
          <li key={step.stepId} className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-sm" data-testid="debug-step" data-status="not-sent">
            <span className="font-medium">{step.stepName}</span> <StatusBadge label="Not sent" tone="neutral" /> <span className="block text-muted">{skipText(step.cause)}</span>
          </li>
        ),
      )}
    </ol>
  );
}

function ChainSection({ chain }: Readonly<{ chain: DebugChainOutcome }>) {
  return (
    <section aria-label={`Chain ${chain.chainName}`} className="space-y-2">
      <h4 className="text-sm font-semibold">{chain.chainName}</h4>
      <StepList steps={chain.steps} />
    </section>
  );
}

export function DebugRunOutput({ result, onReveal }: Readonly<{ result: DebugRunResult; onReveal: RevealValue }>) {
  const [revealed, setRevealed] = useState<ReadonlyMap<string, string>>(new Map());
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set());
  const reveal = useCallback(
    (valueId: string) => {
      void onReveal(valueId).then((value) => {
        if (value === null) setUnavailable((current) => new Set(current).add(valueId));
        else setRevealed((current) => new Map(current).set(valueId, value));
      });
    },
    [onReveal],
  );
  const hide = useCallback((valueId: string) => {
    setRevealed((current) => {
      const next = new Map(current);
      next.delete(valueId);
      return next;
    });
  }, []);
  const state = useMemo<RevealState>(() => ({ revealed, unavailable, reveal, hide }), [revealed, unavailable, reveal, hide]);
  const outcome = OUTCOME[result.outcome];

  return (
    <RevealContext.Provider value={state}>
      <section aria-labelledby="debug-result-title" className="space-y-4" data-testid="debug-run-output">
        <div className="space-y-1">
          <h3 id="debug-result-title" className="text-sm font-semibold">
            Debug run result
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge label={outcome.text} tone={outcome.tone} />
            <span className="text-muted">
              {result.environment.name} · {result.environment.baseUrl} · {Math.round(result.durationMs)} ms
            </span>
          </p>
          {result.dataRows.length > 0 && (
            <p className="text-xs text-muted">
              Data used: {result.dataRows.map((row) => `row ${row.rowNumber} of ${row.dataSetName}`).join(", ")}.
            </p>
          )}
          <ul className="list-disc pl-5 text-xs text-muted">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
        {result.setup.length > 0 && (
          <section aria-label="Once before load steps" className="space-y-2">
            <h4 className="text-sm font-semibold">Once before load</h4>
            <StepList steps={result.setup} />
          </section>
        )}
        {result.chains.map((chain) => (
          <ChainSection key={chain.chainId} chain={chain} />
        ))}
      </section>
    </RevealContext.Provider>
  );
}
