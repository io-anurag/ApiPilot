import type { RecentRequest } from "@apipilot/shared-domain";
import { LIVE_RECENT_REQUEST_LIMIT } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { formatAxisTime } from "./chartScale";
import { formatRequestDuration, requestStatusText, requestStatusTone } from "./liveRunViewModel";

/**
 * The latest completed requests, newest first (AP-045 FR-004, FR-005). It is a sample, not a log: the
 * dashboard keeps the last few only, and says so. The path is the plan's or script's template with
 * no query, so a value in a URL never appears here. The status is a word and a number, never only a
 * colour. The time is the second of the run in which the request finished.
 */
export function LatestRequestsTable({ requests }: Readonly<{ requests: readonly RecentRequest[] }>) {
  return (
    <section aria-labelledby="live-run-latest-title" className="space-y-2 rounded-2xl border border-border bg-surface p-5" data-testid="live-run-latest">
      <div className="space-y-0.5">
        <h4 id="live-run-latest-title" className="text-sm font-semibold">
          Latest requests
        </h4>
        <p className="text-xs text-muted">A sample of the most recent {LIVE_RECENT_REQUEST_LIMIT} completed requests, newest first, not every request. Headers, cookies, tokens and bodies are never shown.</p>
      </div>
      {requests.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface-subtle px-3 py-4 text-center text-sm text-muted">No requests have completed yet.</p>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-160 text-left text-sm">
            <caption className="sr-only">Latest requests of the run, newest first</caption>
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-semibold">Time</th>
                <th scope="col" className="px-3 py-2 font-semibold">Step</th>
                <th scope="col" className="px-3 py-2 font-semibold">Method</th>
                <th scope="col" className="px-3 py-2 font-semibold">Path</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.map((request, index) => (
                <tr key={`${request.second}-${index}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{formatAxisTime(request.second)}</td>
                  <td className="px-3 py-2">{request.chain || "—"}</td>
                  <td className="px-3 py-2">{request.method ? <HttpMethodBadge method={request.method} /> : "—"}</td>
                  <td className="break-all px-3 py-2 font-mono text-xs">{request.path || "—"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge label={requestStatusText(request)} tone={requestStatusTone(request)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">{formatRequestDuration(request.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
