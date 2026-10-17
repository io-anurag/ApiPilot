import { useId, type ReactNode } from "react";
import type { CoverageSnapshot } from "@apipilot/shared-domain";
import type { AiStatusState } from "../../hooks/useAiStatus";
import type { RecentRunsState } from "../../hooks/useRecentRuns";
import { formatRoute, type Route } from "../../navigation/routes";
import { EmptyState } from "../EmptyState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatTile } from "../StatTile";
import { StatusBadge, type StatusTone } from "../StatusBadge";
import { Card, CardHeader } from "../patterns/Card";
import { TaskCard } from "../patterns/TaskCard";
import {
  RUN_STATUS_LABELS,
  RUN_WORKFLOW_LABELS,
  aiStatusText,
  categoryRows,
  methodCounts,
  type FigureView,
  type NextStep,
  type RecentRun,
  type RunStatus,
} from "./homeViewModel";

/** The four summary tiles. A figure with no data is its reason in words, never a number. */
export function SummaryTiles({ figures }: Readonly<{ figures: readonly FigureView[] }>) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="home-summary">
      {figures.map((figure, index) =>
        figure.state === "ready" ? (
          <StatTile key={figure.id} label={figure.label} value={figure.value} sub={figure.sub} highlight={index === 0} />
        ) : (
          <div key={figure.id} data-testid="stat-tile" data-unavailable="true" className={`min-w-0 rounded-2xl border p-4 ${index === 0 ? "border-transparent bg-mint" : "border-border bg-surface shadow-sm"}`}>
            <dt className="text-xs font-semibold text-text-secondary">{figure.label}</dt>
            <dd className="mt-1.5 text-sm text-text-secondary">{figure.reason}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

/** Coverage by area: specification coverage of each requirement group, or the reason it cannot be measured. */
export function CoverageByArea({ snapshot, reason }: Readonly<{ snapshot: CoverageSnapshot | null; reason: string }>) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} data-testid="home-coverage-by-area">
      <CardHeader title="Coverage by area" titleId={titleId} subtitle="Requirements covered by a generated scenario" />
      {snapshot === null ? (
        <p className="text-sm text-text-secondary">{reason}</p>
      ) : (
        <ul className="space-y-3">
          {categoryRows(snapshot).map((row) => (
            <li key={row.group} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-text-primary">{row.label}</span>
                <span className="font-mono text-xs font-semibold text-text-primary">{row.percentage === null ? "Not measured" : `${row.percentage}%`}</span>
              </div>
              {row.percentage === null ? (
                <p className="text-xs text-text-secondary">{row.reason}</p>
              ) : (
                <>
                  <div role="img" aria-label={`${row.label} coverage ${row.percentage}%`} className="h-2 overflow-hidden rounded-full bg-surface-strong">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${row.percentage}%` }} />
                  </div>
                  <p className="text-xs text-text-secondary">{row.detail}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Operations in scope by HTTP method, from the loaded specification; omitted with a reason when there is none. */
export function MethodBreakdown({ snapshot }: Readonly<{ snapshot: CoverageSnapshot | null }>) {
  const titleId = useId();
  const counts = snapshot === null ? [] : methodCounts(snapshot);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <Card as="section" aria-labelledby={titleId} data-testid="home-methods">
      <CardHeader title="Operations in scope" titleId={titleId} subtitle="By HTTP method" />
      {snapshot === null || total === 0 ? (
        <p className="text-sm text-text-secondary">Needs a specification.</p>
      ) : (
        <ul className="space-y-2.5">
          {counts.map((entry) => (
            <li key={entry.method} className="grid grid-cols-[5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm">
              <HttpMethodBadge method={entry.method} />
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface-strong">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((entry.count / total) * 100)}%` }} />
              </div>
              <span className="text-right font-mono text-xs font-semibold text-text-primary">{entry.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What is waiting on the engineer, each a link to where it is done; text when nothing is. */
export function NextSteps({ steps, onOpen }: Readonly<{ steps: readonly NextStep[]; onOpen: (route: Route) => void }>) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} data-testid="home-next-steps">
      <CardHeader title="Next steps" titleId={titleId} subtitle="From what ApiPilot already holds" />
      {steps.length === 0 ? (
        <TaskCard title="Nothing is waiting on you." />
      ) : (
        <ul className="space-y-2.5">
          {steps.map((step, index) => (
            <li key={step.id}>
              <TaskCard
                title={step.title}
                detail={step.detail}
                highlighted={index === 0}
                href={formatRoute(step.route)}
                onClick={(event) => {
                  event.preventDefault();
                  onOpen(step.route);
                }}
                testId={`next-step-${step.id}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const RUN_TONE: Readonly<Record<RunStatus, StatusTone>> = {
  "in-progress": "info",
  completed: "success",
  cancelled: "neutral",
  failed: "danger",
};

function startedText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Recent runs from the three workflows, newest first, each opening its results. */
export function RecentRunsCard({ state, onOpen }: Readonly<{ state: RecentRunsState; onOpen: (run: RecentRun) => void }>) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} data-testid="home-recent-runs">
      <CardHeader title="Recent runs" titleId={titleId} subtitle="Runs this session holds, newest first" />
      {state.status === "loading" && state.runs.length === 0 && <p className="text-sm text-text-secondary">Loading runs…</p>}
      {state.runs.length > 0 && (
        <ul className="divide-y divide-border">
          {state.runs.map((run) => (
            <li key={run.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{run.subject}</p>
                <p className="text-xs text-text-secondary">
                  {RUN_WORKFLOW_LABELS[run.workflow]} · {startedText(run.startedAt)}
                </p>
              </div>
              <StatusBadge label={RUN_STATUS_LABELS[run.status]} tone={RUN_TONE[run.status]} />
              <button
                type="button"
                onClick={() => onOpen(run)}
                aria-label={`Open results of ${run.subject}, ${RUN_WORKFLOW_LABELS[run.workflow]}, ${RUN_STATUS_LABELS[run.status]}`}
                className="text-sm font-semibold text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300"
              >
                Open results
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.status === "ready" && state.runs.length === 0 && (
        <EmptyState message="No runs yet" description={state.unreadable.length > 0 ? "Some runs could not be read, see below." : "Runs from Import & Run Collection, Performance and Run k6 Script appear here."} testId="home-recent-runs-empty" />
      )}
      {state.unreadable.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="home-recent-runs-unreadable">
          {state.unreadable.map((name) => (
            <li key={name} className="text-xs text-warning-700 dark:text-warning-100">
              {name} runs could not be read.
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The AI provider's live readiness in words: never a model identifier or benchmark data. */
export function AiStatusTile({ state }: Readonly<{ state: AiStatusState }>) {
  const titleId = useId();
  let body: ReactNode;
  if (state.kind === "ready") {
    const text = aiStatusText(state.status);
    body = (
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-muted">Status</dt>
          <dd className="font-medium text-text-primary">{text.state}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-muted">Provider</dt>
          <dd className="font-medium text-text-primary">{text.provider}</dd>
        </div>
        {text.reason && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-muted">Reason</dt>
            <dd className="text-text-secondary">{text.reason}</dd>
          </div>
        )}
      </dl>
    );
  } else if (state.kind === "unavailable") {
    body = <p className="text-sm text-text-secondary">AI status unavailable</p>;
  } else {
    body = <p className="text-sm text-text-secondary">Checking the AI provider…</p>;
  }
  return (
    <Card as="section" aria-labelledby={titleId} data-testid="home-ai-status">
      <CardHeader title="AI provider" titleId={titleId} subtitle="Readiness of the configured provider" />
      {body}
    </Card>
  );
}
