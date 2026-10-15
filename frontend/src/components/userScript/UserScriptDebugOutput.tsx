import type { UserScriptDebugCutOffReason, UserScriptDebugExchange, UserScriptDebugOutcome, UserScriptDebugResult } from "@apipilot/shared-domain";
import { USER_SCRIPT_DEBUG_MAX_EXCHANGES, USER_SCRIPT_DEBUG_TIME_LIMIT_MS } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { CodeBlock } from "../CodeBlock";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge, type StatusTone } from "../StatusBadge";
import { BodyBlock, HeaderTable, Masked, RevealProvider } from "../requestChain/DebugRunOutput";
import type { UserScriptDebugRun } from "./useUserScriptDebugRun";

/**
 * The output of a Debug run of a supplied script (specs/053-user-script-debug-run User Story 1, 2): one
 * card per request k6 logged, with the request that went out and the response that came back. Every piece
 * of text arrives already masked by the server (`MaskedText`) and is drawn by the same parts as the
 * request-chain Debug run, including the one-at-a-time reveal of a credential that came from the target.
 * A value mapped from the environment has no control, because the server never sent it. Outcomes use words
 * as well as colour.
 */

const OUTCOME: Record<Exclude<UserScriptDebugOutcome, "cut-off">, { text: string; tone: StatusTone }> = {
  completed: { text: "Completed", tone: "success" },
  failed: { text: "Failed", tone: "danger" },
  "no-requests": { text: "No requests sent", tone: "neutral" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

const CUT_OFF: Record<UserScriptDebugCutOffReason, string> = {
  "exchange-limit": `Cut off after ${USER_SCRIPT_DEBUG_MAX_EXCHANGES} requests`,
  "time-limit": `Cut off at the ${USER_SCRIPT_DEBUG_TIME_LIMIT_MS / 1000} second limit`,
};

export function outcomeOf(result: UserScriptDebugResult): { text: string; tone: StatusTone } {
  if (result.outcome === "cut-off") return { text: CUT_OFF[result.cutOffReason ?? "time-limit"], tone: "warning" };
  return OUTCOME[result.outcome];
}

function needsAttention(exchange: UserScriptDebugExchange): boolean {
  return exchange.response === null || exchange.response.status >= 400;
}

function Exchange({ exchange }: Readonly<{ exchange: UserScriptDebugExchange }>) {
  const failed = needsAttention(exchange);
  const { response, request } = exchange;
  const status = response ? `${response.status}${response.statusText ? ` ${response.statusText}` : ""}` : "No response";
  return (
    <li className="rounded-md border border-border bg-surface" data-testid="debug-exchange">
      <details open={failed}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <span className="font-mono text-xs text-muted">#{exchange.index}</span>
          <HttpMethodBadge method={request.method} />
          <span className="min-w-0 break-all font-medium">{exchange.name ? <Masked text={exchange.name} /> : <Masked text={request.url} />}</span>
          <StatusBadge label={status} tone={failed ? "danger" : "success"} />
        </summary>
        <div className="space-y-3 border-t border-border px-3 py-3">
          <p className="text-sm">
            <span className="text-xs font-semibold uppercase text-muted">Request</span>{" "}
            <code className="font-mono text-xs wrap-anywhere">
              {request.method} <Masked text={request.url} />
            </code>
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <HeaderTable headers={request.headers} label="Request headers" />
              <BodyBlock body={request.body} label="Request body" />
            </div>
            <div className="min-w-0 space-y-3">
              {response ? (
                <>
                  <p className="text-sm">
                    <span className="text-xs font-semibold uppercase text-muted">Response</span> {status}
                  </p>
                  <HeaderTable headers={response.headers} label="Response headers" />
                  <BodyBlock body={response.body} label="Response body" />
                </>
              ) : (
                <p className="text-sm" role="note">
                  <span className="text-xs font-semibold uppercase text-muted">Response</span> None. No response was received: the connection failed or the request timed out.
                </p>
              )}
            </div>
          </div>
        </div>
      </details>
    </li>
  );
}

/**
 * The Debug run's progress, failure or output, inside the launch card on Runs & reports, as the Performance
 * Run step shows its Debug run. Nothing here sends anything; cancelling is the launch card's button.
 */
export function UserScriptDebugView({ debug }: Readonly<{ debug: UserScriptDebugRun }>) {
  const { state } = debug;
  if (state.kind === "idle") return null;
  if (state.kind === "running") {
    return (
      <p className="text-sm" role="status" data-testid="debug-running">
        Running the script once…
      </p>
    );
  }
  if (state.kind === "failed") return <ErrorState message="The debug run could not run." detail={state.message} testId="debug-run-error" />;

  const { result } = state;
  const outcome = outcomeOf(result);
  return (
    <RevealProvider onReveal={debug.reveal}>
      <section aria-labelledby="user-script-debug-title" className="space-y-4" data-testid="user-script-debug-output">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 id="user-script-debug-title" className="text-sm font-semibold">
              Debug run result
            </h3>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge label={outcome.text} tone={outcome.tone} />
              <span className="text-muted">
                {result.environment.name} · {result.environment.baseUrl} · {Math.round(result.durationMs)} ms · {result.exchanges.length === 1 ? "1 request" : `${result.exchanges.length} requests`}
              </span>
            </p>
          </div>
          <button type="button" className={BUTTON_STYLES.secondary} onClick={debug.close}>
            Close debug output
          </button>
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        {result.k6Message && <CodeBlock label="k6's message (at most 2,000 characters)" content={result.k6Message} />}
        {result.exchanges.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface-subtle px-3 py-4 text-center text-sm text-muted">
            {result.outcome === "failed" ? "k6 did not send a request." : "The script ran without sending an HTTP request."}
          </p>
        ) : (
          <ol className="space-y-2">
            {result.exchanges.map((exchange) => (
              <Exchange key={exchange.index} exchange={exchange} />
            ))}
          </ol>
        )}
      </section>
    </RevealProvider>
  );
}
