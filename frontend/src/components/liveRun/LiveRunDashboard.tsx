import { useEffect, type ReactNode } from "react";
import type { LiveChainRow, LiveRunKind, LiveRunSnapshot } from "@apipilot/shared-domain";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Skeleton } from "../Skeleton";
import { StatTile } from "../StatTile";
import { StatusBadge } from "../StatusBadge";
import { formatAxisTime } from "./chartScale";
import { LatestRequestsTable } from "./LatestRequestsTable";
import { LiveRunChart } from "./LiveRunChart";
import {
  failureShare,
  formatClock,
  formatCount,
  formatElapsed,
  formatRate,
  formatRequestDuration,
  LIVE_STATE_BADGE,
  LIVE_STATE_TITLE,
  NO_REQUESTS_YET,
  peakVirtualUsers,
  recentRate,
  progressPercent,
} from "./liveRunViewModel";
import { useLiveRun, type LiveRunView } from "./useLiveRun";

export type LiveRunDashboardProps = Readonly<{
  kind: LiveRunKind;
  runId: string;
  /** Required for `collection`. */
  collectionId?: string;
  /** What the run is (for example "Setup Run · Smoke · started 4:15:39 PM"), shown beside the state. */
  meta?: string;
  /** Controls the host keeps with the run, such as Cancel run, shown at the right of the heading. */
  actions?: ReactNode;
  /** Called with each good reply, so the host can read the final state or totals. */
  onSnapshot?: (snapshot: LiveRunSnapshot) => void;
}>;

/**
 * The live figures of one run (AP-045): a heading card with the state and the counters, the run
 * graphed over time beside the figures per chain, and the latest requests. One component for all
 * three run kinds; a figure a kind cannot supply is left out, and a figure that is not available yet
 * says so rather than showing zero. It only reads (`liveRunClient`); Cancel stays with the host panel,
 * which passes it in `actions`.
 */
export function LiveRunDashboard({
  kind,
  runId,
  collectionId,
  meta,
  actions,
  onSnapshot,
}: LiveRunDashboardProps) {
  const view = useLiveRun({ kind, runId, collectionId });
  const { snapshot } = view;

  useEffect(() => {
    if (snapshot && onSnapshot) onSnapshot(snapshot);
  }, [snapshot, onSnapshot]);

  return (
    <section
      aria-label="Live run figures"
      className="min-w-0 space-y-4"
      data-testid="live-run-dashboard"
      data-status={view.status}
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4">
          <h3 className="text-lg font-semibold">{LIVE_STATE_TITLE[view.status]}</h3>
          <StatePill view={view} />
          {meta && <span className="min-w-0 break-words text-xs text-muted">{meta}</span>}
          {snapshot?.inFlight && (
            <p className="min-w-0 break-words text-sm" data-testid="live-run-in-flight">
              <span className="text-muted">Sending</span>{" "}
              <span className="font-medium">{snapshot.inFlight}</span>
            </p>
          )}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
        <StatePanel view={view} />
        {snapshot && <Counters snapshot={snapshot} />}
      </div>
      {snapshot && <Detail snapshot={snapshot} />}
    </section>
  );
}

function StatePill({ view }: Readonly<{ view: LiveRunView }>) {
  const badge = LIVE_STATE_BADGE[view.status];
  if (view.status === "live") {
    return (
      <span
        data-testid="status-badge"
        data-tone="danger"
        className="inline-flex items-center gap-1.5 rounded-full bg-danger-100 px-2.5 py-0.5 text-xs font-semibold text-danger-700 dark:bg-danger-500/15 dark:text-danger-100"
      >
        <span
          aria-hidden="true"
          className="size-2 animate-pulse rounded-full bg-current motion-reduce:animate-none"
        />
        {badge.label}
      </span>
    );
  }
  if (view.status === "stale") {
    return (
      <StatusBadge
        label={
          view.lastGoodAt === null
            ? "Stale: no figures yet"
            : `Stale: no figures since ${formatClock(view.lastGoodAt)}`
        }
        tone="warning"
      />
    );
  }
  if (view.status === "cancelled" && view.snapshot) {
    return (
      <StatusBadge
        label={`Cancelled at ${formatAxisTime(view.snapshot.elapsedMs / 1000)}`}
        tone="neutral"
      />
    );
  }
  return <StatusBadge label={badge.label} tone={badge.tone} />;
}

function StatePanel({ view }: Readonly<{ view: LiveRunView }>) {
  const strip = "border-t px-5 py-2 text-sm";
  switch (view.status) {
    case "loading":
      return (
        <div
          role="status"
          aria-busy="true"
          className="space-y-2 border-t border-border p-5"
          data-testid="live-run-loading"
        >
          <span className="sr-only">Loading live figures…</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Skeleton className="h-16 w-full rounded-lg bg-surface-strong" />
            <Skeleton className="h-16 w-full rounded-lg bg-surface-strong" />
            <Skeleton className="h-16 w-full rounded-lg bg-surface-strong" />
          </div>
          <Skeleton className="h-32 w-full rounded-lg bg-surface-strong" />
        </div>
      );
    case "stale":
      return (
        <p
          role="status"
          className={`${strip} border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100`}
          data-testid="live-run-stale"
        >
          {view.lastGoodAt === null
            ? "Live figures have not arrived yet. ApiPilot keeps asking; the run itself is not affected."
            : `Figures stale since ${formatClock(view.lastGoodAt)}. The numbers below are the last ones received. ApiPilot keeps asking; the run itself is not affected.`}
        </p>
      );
    case "error":
      return (
        <div className="border-t border-border p-5">
          <ErrorState
            message="Live figures are unavailable."
            detail={view.error?.message}
            testId="live-run-error"
          >
            {view.snapshot && <p>The figures below are the last ones received.</p>}
          </ErrorState>
        </div>
      );
    case "failed":
      return (
        <div className="border-t border-border p-5">
          <ErrorState
            message="The run ended in error."
            detail="The figures below are what it reached before it ended."
            testId="live-run-failed"
          />
        </div>
      );
    case "cancelled":
      return (
        <p
          role="status"
          className={`${strip} border-border bg-surface-subtle text-text-secondary`}
          data-testid="live-run-cancelled"
        >
          The run was cancelled. The figures below are what it reached.
        </p>
      );
    case "completed":
      return (
        <p
          role="status"
          className={`${strip} border-success-100 bg-success-50 text-success-700 dark:border-success-500 dark:bg-success-500/10 dark:text-success-100`}
          data-testid="live-run-completed"
        >
          The run completed. These are its final figures.
        </p>
      );
    case "live":
      return null;
  }
}

function Counters({ snapshot }: Readonly<{ snapshot: LiveRunSnapshot }>) {
  const {
    totals,
    latency,
    plannedRequests,
    plannedDurationMs,
    currentVirtualUsers,
    series,
  } = snapshot;
  const showLatency = snapshot.kind !== "collection";
  const percent = progressPercent(snapshot.elapsedMs, plannedDurationMs);
  const current = recentRate(series.points, series.bucketSeconds);
  const rate = current === null ? undefined : `${formatRate(current)} req/s`;
  const peak = peakVirtualUsers(series.points);
  return (
    <>
      <div className="overflow-hidden">
        <dl
          className="-mb-px -mr-px grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] border-t border-border"
          data-testid="live-run-tiles"
        >
          <StatTile
            flat
            label="Requests done"
            value={formatCount(totals.requests)}
            sub={plannedRequests !== null ? `of ${formatCount(plannedRequests)}` : rate}
          />
          <StatTile
            flat
            label="Failures"
            value={formatCount(totals.failures)}
            tone={totals.failures > 0 ? "danger" : "neutral"}
            sub={failureShare(totals.failures, totals.requests) ?? undefined}
          />
          {currentVirtualUsers !== null && (
            <StatTile
              flat
              label="Virtual users"
              value={formatCount(currentVirtualUsers)}
              sub={peak !== null ? `peak ${formatCount(peak)}` : undefined}
            />
          )}
          <StatTile
            flat
            label="Elapsed"
            value={formatElapsed(snapshot.elapsedMs)}
            sub={
              plannedDurationMs !== null
                ? `of ${formatElapsed(plannedDurationMs)} planned`
                : undefined
            }
          />
          {showLatency && (
            <StatTile
              flat
              label="Average latency"
              value={latency ? formatRequestDuration(latency.averageMs) : NO_REQUESTS_YET}
              sub={
                latency
                  ? `p95 latency ${formatRequestDuration(latency.p95Ms)}`
                  : undefined
              }
            />
          )}
        </dl>
      </div>
      {plannedRequests !== null && plannedRequests > 0 && (
        <div data-testid="live-run-progress">
          <progress
            className="block h-1.5 w-full accent-brand-600"
            aria-label="Requests done"
            max={plannedRequests}
            value={Math.min(totals.requests, plannedRequests)}
          />
          <p className="px-5 py-2 text-xs text-muted">
            {formatCount(totals.requests)} of {formatCount(plannedRequests)} requests
          </p>
        </div>
      )}
      {percent !== null && (
        <div data-testid="live-run-progress">
          <progress
            className="block h-1.5 w-full accent-brand-600"
            aria-label="Planned time elapsed"
            max={100}
            value={percent}
          />
          <p className="sr-only">{percent}% of the planned time</p>
        </div>
      )}
    </>
  );
}

function Detail({ snapshot }: Readonly<{ snapshot: LiveRunSnapshot }>) {
  const hasChains = snapshot.chains.length > 0;
  return (
    <div className="@container space-y-4">
      <div
        className={`grid items-start gap-4 ${hasChains ? "@4xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : ""}`}
      >
        <section
          aria-label="Requests over time"
          className="min-w-0 rounded-2xl border border-border bg-surface p-5"
        >
          <LiveRunChart
            series={snapshot.series}
            thinned={snapshot.thinned}
            plannedSeconds={
              snapshot.plannedDurationMs === null
                ? null
                : snapshot.plannedDurationMs / 1000
            }
          />
        </section>
        {hasChains && <ChainRows chains={snapshot.chains} />}
      </div>
      <LatestRequestsTable requests={snapshot.recent} />
    </div>
  );
}

function ChainRows({ chains }: Readonly<{ chains: readonly LiveChainRow[] }>) {
  const busiest = Math.max(1, ...chains.map((chain) => chain.requests));
  return (
    <section
      aria-labelledby="live-run-chains-title"
      className="min-w-0 space-y-1 rounded-2xl border border-border bg-surface p-5"
      data-testid="live-run-chains"
    >
      <h4 id="live-run-chains-title" className="text-sm font-semibold">
        Chains
      </h4>
      <p className="pb-2 text-xs text-muted">Requests and failures so far, per chain.</p>
      <ul className="divide-y divide-border">
        {chains.map((chain) => (
          <li key={chain.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                {chain.method && <HttpMethodBadge method={chain.method} />}
                <span className="min-w-0 break-words font-medium">{chain.label}</span>
                {chain.path && (
                  <span className="break-all font-mono text-xs text-muted">
                    {chain.path}
                  </span>
                )}
              </p>
              <progress
                className="block h-1.5 w-full accent-brand-600"
                aria-label={`${chain.label}: share of the busiest chain`}
                max={busiest}
                value={chain.requests}
              />
            </div>
            <p className="shrink-0 text-right font-mono text-xs text-muted">
              <span className="block">{formatCount(chain.requests)} req</span>
              <span
                className={
                  chain.failures > 0
                    ? "block text-danger-700 dark:text-danger-100"
                    : "block"
                }
              >
                {formatCount(chain.failures)} failed
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
