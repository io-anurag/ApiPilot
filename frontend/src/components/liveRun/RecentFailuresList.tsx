import { useState } from "react";
import type { FailureResponse, LiveRunKind, RecentFailure } from "@apipilot/shared-domain";
import { LIVE_RECENT_FAILURE_LIMIT } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { formatAxisTime } from "./chartScale";
import { formatClockUtc, formatResponseText } from "./liveRunViewModel";

const COLUMNS = 6;

/** Why a script run's failures have no response (specs/052-user-script-recent-failures FR-005). */
export const NOT_CAPTURED_NOTE = "ApiPilot runs a script you supply as it is and cannot see the response, so none is shown.";

function statusLabel(status: number | null): string {
  return status === null ? "No response" : `Failed ${status}`;
}

function ResponseView({ response }: Readonly<{ response: FailureResponse }>) {
  if (response.kind === "none-received") {
    return <p className="text-sm text-muted">No response was received: the connection failed or the request timed out.</p>;
  }
  if (response.kind === "not-captured") {
    return <p className="text-sm text-muted">{NOT_CAPTURED_NOTE}</p>;
  }
  if (response.kind === "withheld") {
    return <p className="text-sm text-muted">Response not kept: this plan uses secret data set columns, and an error response could echo one back.</p>;
  }
  if (response.kind === "empty") {
    return <p className="text-sm text-muted">The response had no body{response.contentType ? ` (${response.contentType})` : ""}.</p>;
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">
        Response body{response.contentType ? ` · ${response.contentType}` : ""}
        {response.truncated ? " · cut short" : ""}
      </p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-subtle p-3 font-mono text-xs text-text-primary" tabIndex={0} aria-label="Response body">
        {formatResponseText(response.text, response.contentType, response.truncated)}
      </pre>
    </div>
  );
}

/**
 * The failed requests of a request-chain run, newest first, each with the response the server sent
 * (AP-049). It is a sample: at most one failure a second per virtual user, and only the latest few are
 * kept. The response is held in memory while the run is open; it is masked for secrets, cut to a size
 * limit, and never stored, reported or logged. The counts elsewhere on the dashboard are exact. A Run k6
 * Script run (AP-052) lists the same columns, but ApiPilot cannot see the response of a script it does not
 * generate, so each such row says "Not captured" instead of offering a response.
 */
export function RecentFailuresList({ failures, startedAt, kind = "chain" }: Readonly<{ failures: readonly RecentFailure[]; startedAt?: string; kind?: LiveRunKind }>) {
  // The newest failure starts open; the engineer's own choices stand after that.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const keyOf = (failure: RecentFailure, index: number) => `${failure.second}-${failure.status}-${failure.path}-${index}`;

  return (
    <section aria-labelledby="live-run-failures-title" className="space-y-2 rounded-2xl border border-border bg-surface p-5" data-testid="live-run-failures">
      <div className="space-y-0.5">
        <h4 id="live-run-failures-title" className="text-sm font-semibold">
          Recent failures
        </h4>
        {kind === "user-script" ? (
          <p className="text-xs text-muted">
            A sample of the latest {LIVE_RECENT_FAILURE_LIMIT} failed requests, not every failure: at most one for each request and status in a second. {NOT_CAPTURED_NOTE} Only the request and its status are kept, and nothing here is saved to the run, its report or any log.
          </p>
        ) : (
          <p className="text-xs text-muted">
            A sample of the latest {LIVE_RECENT_FAILURE_LIMIT} failed requests with the response each one got, not every failure. Secret values are masked, long responses are cut, and nothing here is saved to the run, its report or any log.
          </p>
        )}
      </div>
      {failures.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface-subtle px-3 py-4 text-center text-sm text-muted">No failed requests have been sampled.</p>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-160 text-left text-sm">
            <caption className="sr-only">Recent failed requests of the run, newest first</caption>
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-semibold">{startedAt ? "Time (UTC)" : "Time"}</th>
                <th scope="col" className="px-3 py-2 font-semibold">Step</th>
                <th scope="col" className="px-3 py-2 font-semibold">Method</th>
                <th scope="col" className="px-3 py-2 font-semibold">Path</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Response</th>
              </tr>
            </thead>
            {failures.map((failure, index) => {
              const key = keyOf(failure, index);
              const captured = failure.response.kind !== "not-captured";
              const open = captured && (toggled.get(key) ?? index === 0);
              const panelId = `live-run-failure-${index}`;
              return (
                <tbody key={key} className="border-b border-border last:border-b-0">
                  <tr>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{startedAt ? formatClockUtc(startedAt, failure.second) : formatAxisTime(failure.second)}</td>
                    <td className="px-3 py-2">{failure.chain || "—"}</td>
                    <td className="px-3 py-2">{failure.method ? <HttpMethodBadge method={failure.method} /> : "—"}</td>
                    <td className="break-all px-3 py-2 font-mono text-xs">{failure.path || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <StatusBadge label={statusLabel(failure.status)} tone="danger" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {captured ? (
                        <button
                          type="button"
                          className={BUTTON_STYLES.ghost}
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() => setToggled((current) => new Map(current).set(key, !open))}
                        >
                          {open ? "Hide response" : "Show response"}
                        </button>
                      ) : (
                        <span className="text-xs text-muted">Not captured</span>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr id={panelId}>
                      <td colSpan={COLUMNS} className="px-3 pb-3 pt-0">
                        <ResponseView response={failure.response} />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}
