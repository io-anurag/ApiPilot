import { useId, useState, type ReactNode } from "react";
import type { AiStatusState } from "../../hooks/useAiStatus";
import type { RecentRunsState } from "../../hooks/useRecentRuns";
import { formatRoute, type Route } from "../../navigation/routes";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { Skeleton } from "../Skeleton";
import { StatusBadge, type StatusTone } from "../StatusBadge";
import { ArtifactProductIcon, WorkflowIcon } from "../WorkflowIcon";
import { Card, CardHeader } from "../patterns/Card";
import { StepHeading } from "./StepHeading";
import {
  RECENT_RUNS_VISIBLE,
  RUN_STATUS_LABELS,
  RUN_WORKFLOW_LABELS,
  aiStatusText,
  type FigureView,
  type NextStep,
  type RecentRun,
  type RunStatus,
  type RunWorkflow,
} from "./homeViewModel";

const LINK_FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const TEXT_LINK = `font-semibold text-brand-700 hover:underline ${LINK_FOCUS}`;

function stepLink(route: Route, onOpen: (route: Route) => void) {
  return {
    href: formatRoute(route),
    onClick: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      onOpen(route);
    },
  };
}

// ---- Step 3: results and insights ----------------------------------------------------------

type FigureTone = "success" | "danger" | "info";

const FIGURE_TONE: Readonly<Record<string, { tone: FigureTone; icon: ReactNode }>> = {
  "spec-coverage": {
    tone: "success",
    icon: (
      <>
        <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
        <path d="M14 3v5h5M9 14l2 2 4-4" />
      </>
    ),
  },
  "runtime-verified": {
    tone: "success",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8.5 5 3.5-5 3.5z" />
      </>
    ),
  },
  "open-gaps": {
    tone: "danger",
    icon: (
      <>
        <path d="M12 3 2.5 20h19z" />
        <path d="M12 10v4.5M12 17.5h.01" />
      </>
    ),
  },
  "pending-scenarios": {
    tone: "info",
    icon: (
      <>
        <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </>
    ),
  },
};

const TONE_ICON: Readonly<Record<FigureTone, string>> = {
  success: "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-100",
  danger: "bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-100",
  info: "bg-info-100 text-info-700 dark:bg-info-500/15 dark:text-info-100",
};

const TONE_BAR: Readonly<Record<FigureTone, string>> = {
  success: "bg-success-500",
  danger: "bg-danger-500",
  info: "bg-info-500",
};

/** `quiet` omits the reason: when no figure has data for one shared cause, the panel says it once instead of in every tile. */
function FigureTile({ figure, quiet }: Readonly<{ figure: FigureView; quiet: boolean }>) {
  const look = FIGURE_TONE[figure.id] ?? { tone: "info" as const, icon: null };
  const percent = figure.state === "ready" ? Math.round(figure.ratio * 100) : 0;
  return (
    <div data-testid="home-figure" data-unavailable={figure.state === "unavailable" ? "true" : undefined} className="min-w-0 space-y-3 xl:px-5 xl:first:pl-0 xl:last:pr-0">
      <div className="flex gap-3">
        <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_ICON[look.tone]}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            {look.icon}
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">{figure.label}</p>
          <p className="text-xs text-text-secondary">{figure.description}</p>
        </div>
      </div>
      {figure.state === "ready" ? (
        <div>
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-surface-strong">
              <div className={`h-full rounded-full ${TONE_BAR[look.tone]}`} style={{ width: `${percent}%` }} />
            </div>
            <span className="font-display text-sm font-bold text-text-primary">{figure.value}</span>
          </div>
          {figure.sub && <p className="mt-1 text-xs text-muted">{figure.sub}</p>}
        </div>
      ) : (
        !quiet && <p className="text-xs font-medium text-text-secondary">{figure.reason}</p>
      )}
    </div>
  );
}

/**
 * Step 3 (AP-059 FR-005): the four coverage figures from the same snapshot the Coverage screen shows. The panel is always
 * there; a figure with no data says why in words and draws no bar, never a number. With a specification loaded the step
 * also names it.
 */
export function InsightsStep({
  specification,
  figures,
  coverageLoaded,
  coverageFailed,
  links,
}: Readonly<{
  specification: { title: string; detail: string } | null;
  figures: readonly FigureView[];
  coverageLoaded: boolean;
  /** Coverage could not be calculated for a reason other than "no specification"; the line naming it is an alert. */
  coverageFailed: boolean;
  links: ReactNode;
}>) {
  const titleId = useId();
  const unavailable = figures.find((figure) => figure.state === "unavailable");
  const reason = coverageLoaded ? null : unavailable?.state === "unavailable" ? unavailable.reason : "Loading coverage…";
  return (
    <section aria-labelledby={titleId} data-testid="home-spec-status" className="space-y-4">
      <StepHeading number={3} title="Explore results and insights" titleId={titleId} description="View coverage, validate operations and track test execution results." actions={links} />
      <div className="space-y-4 rounded-2xl border border-border bg-surface-subtle p-4 sm:p-5">
        {specification && (
          <p data-testid="home-spec-context" className="text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">{specification.title}</span>
            {specification.detail && <span> · {specification.detail}</span>}
          </p>
        )}
        {reason && (
          <p data-testid="home-summary-reason" role={coverageFailed ? "alert" : undefined} className="text-sm font-medium text-text-secondary">
            {reason}
          </p>
        )}
        <div data-testid="home-summary" className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-0 xl:divide-x xl:divide-border-strong">
          {figures.map((figure) => (
            <FigureTile key={figure.id} figure={figure} quiet={!coverageLoaded} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Next steps ------------------------------------------------------------------------------

/** A completed clipboard: decorative, beside the "all set" message. */
function ClipboardIllustration() {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" focusable="false" className="absolute bottom-1 right-1 h-24 w-24 opacity-80">
      <rect x="14" y="10" width="46" height="60" rx="8" className="fill-surface stroke-border-strong" strokeWidth="2" />
      <rect x="28" y="4" width="18" height="12" rx="4" className="fill-sage stroke-border-strong" strokeWidth="2" />
      <path d="M24 30h26M24 40h26M24 50h14" className="stroke-border-strong" strokeWidth="3" strokeLinecap="round" />
      <circle cx="56" cy="56" r="14" className="fill-success-500" />
      <path d="m50 56 4 4 8-8" className="stroke-white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * What is waiting on the engineer (AP-054 FR-021), each a link to where it is done. The first step is the one
 * action Home asks for, shown as a button; any others follow as plain links. With nothing pending it says so in
 * words, never as an empty box. Until the session's workflow has been read it shows a loading state, so the card
 * never changes under the pointer after first paint.
 */
export function NextStepsCard({ steps, ready, onOpen }: Readonly<{ steps: readonly NextStep[]; ready: boolean; onOpen: (route: Route) => void }>) {
  const titleId = useId();
  const [first, ...rest] = steps;
  let body: ReactNode;
  if (!ready) {
    body = (
      <div role="status" aria-label="Loading next steps" className="space-y-2">
        <Skeleton className="h-5 w-2/3 rounded bg-surface-strong" />
        <Skeleton className="h-4 w-full rounded bg-surface-strong" />
      </div>
    );
  } else if (first === undefined) {
    body = (
      <div data-testid="home-next-steps" className="relative min-h-40">
        <div className="flex min-w-0 items-start gap-3 pr-24">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-700 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-text-primary">Nothing is waiting on you.</p>
            <p className="mt-1 text-sm text-text-secondary">You're all set! Start a new test session or dive into recent results.</p>
          </div>
        </div>
        <ClipboardIllustration />
      </div>
    );
  } else {
    body = (
      <div data-testid="home-next-steps" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a {...stepLink(first.route, onOpen)} data-testid={`next-step-${first.id}`} className={`inline-block ${BUTTON_STYLES.primary}`}>
            {first.title}
          </a>
          <span className="text-xs text-muted">{first.detail}</span>
        </div>
        {rest.length > 0 && (
          <ul className="space-y-1">
            {rest.map((step) => (
              <li key={step.id} className="text-sm">
                <a {...stepLink(step.route, onOpen)} data-testid={`next-step-${step.id}`} className={TEXT_LINK}>
                  {step.title}
                </a>
                <span className="text-xs text-muted"> · {step.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <Card as="section" aria-labelledby={titleId} className="h-full">
      <CardHeader title="Next steps" titleId={titleId} subtitle="From what ApiPilot already holds" />
      <div className="rounded-xl bg-gradient-to-br from-mint via-mint/60 to-surface-subtle p-5">{body}</div>
    </Card>
  );
}

// ---- Recent runs ---------------------------------------------------------------------------

const RUN_TONE: Readonly<Record<RunStatus, StatusTone>> = {
  "in-progress": "info",
  completed: "success",
  cancelled: "neutral",
  failed: "danger",
};

/** The product mark of the workflow that produced a run, so a row is recognisable before it is read. */
function RunIcon({ workflow }: Readonly<{ workflow: RunWorkflow }>) {
  if (workflow === "import") return <ArtifactProductIcon name="postman" className="h-7 w-7" />;
  if (workflow === "k6") return <ArtifactProductIcon name="k6" className="h-7 w-7" />;
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-info-100 text-info-700 dark:bg-info-500/15 dark:text-info-100">
      <WorkflowIcon name="performance" className="h-4 w-4" />
    </span>
  );
}

function startedText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Recent runs from the three workflows, newest first, each opening its results. The newest five are shown; "View all"
 * (only when there are more) shows every run read and back, so a long history does not push everything else away.
 */
export function RecentRunsCard({ state, onOpen }: Readonly<{ state: RecentRunsState; onOpen: (run: RecentRun) => void }>) {
  const titleId = useId();
  const [showAll, setShowAll] = useState(false);
  const hidden = Math.max(0, state.runs.length - RECENT_RUNS_VISIBLE);
  const visible = showAll ? state.runs : state.runs.slice(0, RECENT_RUNS_VISIBLE);
  return (
    <Card as="section" aria-labelledby={titleId} data-testid="home-recent-runs" className="h-full">
      <CardHeader
        title="Recent runs"
        titleId={titleId}
        subtitle="Runs this session holds, newest first"
        actions={
          hidden > 0 && (
            <button
              type="button"
              aria-expanded={showAll}
              aria-label={showAll ? "Show fewer runs" : `View all ${state.runs.length} runs`}
              onClick={() => setShowAll((current) => !current)}
              className={`text-sm ${TEXT_LINK}`}
            >
              {showAll ? "Show fewer" : "View all →"}
            </button>
          )
        }
      />
      {state.status === "loading" && state.runs.length === 0 && <p className="text-sm text-text-secondary">Loading runs…</p>}
      {visible.length > 0 && (
        <ul className="divide-y divide-border">
          {visible.map((run) => (
            <li key={run.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <RunIcon workflow={run.workflow} />
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
                className={`text-sm ${TEXT_LINK}`}
              >
                Open results
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.status === "ready" && state.runs.length === 0 && (
        <EmptyState compact message="No runs yet." description={state.unreadable.length > 0 ? "Some runs could not be read, see below." : "Runs from Import & Run Collection, Performance and Run k6 Script appear here."} testId="home-recent-runs-empty" />
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

// ---- AI provider ---------------------------------------------------------------------------

const AI_TONE = { ready: "success", loading: "info", "not-loaded": "neutral", unavailable: "danger" } as const satisfies Record<string, StatusTone>;

const AI_DOT: Readonly<Record<StatusTone, string>> = {
  success: "bg-success-500 ring-success-500/25",
  info: "bg-info-500 ring-info-500/25",
  neutral: "bg-muted ring-muted/25",
  warning: "bg-warning-500 ring-warning-500/25",
  danger: "bg-danger-500 ring-danger-500/25",
};

/**
 * The AI provider's live readiness (AP-059 FR-008), in words: never a model identifier or benchmark data. There is no
 * control to configure it here because the provider is chosen by the server's configuration, not in the application.
 */
export function AiProviderCard({ state }: Readonly<{ state: AiStatusState }>) {
  const titleId = useId();
  let body: ReactNode;
  if (state.kind === "ready") {
    const text = aiStatusText(state.status);
    const tone = AI_TONE[state.status.state];
    body = (
      <dl className="flex flex-wrap items-center gap-x-10 gap-y-3">
        <div>
          <dt className="text-xs text-muted">Status</dt>
          <dd className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ring-4 ${AI_DOT[tone]}`} />
            {text.state}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Provider</dt>
          <dd className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5 text-text-secondary">
              <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />
            </svg>
            {text.provider}
          </dd>
        </div>
        {text.reason && (
          <div className="min-w-0">
            <dt className="text-xs text-muted">Reason</dt>
            <dd className="text-sm text-text-secondary">{text.reason}</dd>
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
      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-text-primary">
            AI provider
          </h2>
          <p className="text-xs text-muted">Readiness of the configured provider</p>
        </div>
        {body}
      </div>
    </Card>
  );
}
