import { useId } from "react";
import { formatRoute, type Route } from "../../navigation/routes";
import type { StageGroup, StageItem } from "../../navigation/destinations";

const ITEM =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

function StateMark({ stage }: Readonly<{ stage: StageItem }>) {
  if (stage.state === "done") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Done" className="h-3.5 w-3.5 shrink-0 text-success-700 dark:text-success">
        <path d="m5 12 5 5 9-10" />
      </svg>
    );
  }
  if (stage.state === "stale") {
    return <span className="shrink-0 rounded-full bg-warning-100 px-1.5 text-[10px] font-semibold text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">Redo</span>;
  }
  if (stage.state === "locked") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Locked" className="h-3.5 w-3.5 shrink-0 text-muted">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />;
}

function StageEntry({
  stage,
  onNavigate,
}: Readonly<{ stage: StageItem; onNavigate: (route: Route) => void }>) {
  const reasonId = useId();
  const testId = `sidebar-stage-${stage.id}`;

  if (stage.state === "locked") {
    return (
      <li className="group relative">
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={reasonId}
          data-testid={testId}
          className={`${ITEM} cursor-not-allowed text-muted`}
        >
          <span className="min-w-0 flex-1 leading-tight">{stage.label}</span>
          <StateMark stage={stage} />
        </button>
        <span
          id={reasonId}
          role="tooltip"
          className="pointer-events-none absolute top-full left-2 z-30 mt-0.5 hidden whitespace-nowrap rounded-md border border-border-strong bg-surface-elevated px-2 py-1 text-xs text-text-primary shadow-md group-focus-within:block group-hover:block"
        >
          {stage.lockReason}
        </span>
      </li>
    );
  }

  const route: Route = { view: "guided", stage: stage.id };
  return (
    <li>
      <a
        href={formatRoute(route)}
        aria-current={stage.current ? "step" : undefined}
        data-testid={testId}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onNavigate(route);
        }}
        className={`${ITEM} ${
          stage.current
            ? "bg-lime-pale font-semibold text-text-primary ring-1 ring-inset ring-brand-500 forced-colors:outline forced-colors:outline-2"
            : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        }`}
      >
        <span className="min-w-0 flex-1 leading-tight">{stage.label}</span>
        {stage.optional && <span className="shrink-0 text-[10px] text-muted">Optional</span>}
        <StateMark stage={stage} />
      </a>
    </li>
  );
}

/** The eleven guided stages in their four groups (AP-054 FR-003). */
export function SidebarStages({
  groups,
  onNavigate,
  id,
}: Readonly<{
  groups: readonly StageGroup[];
  onNavigate: (route: Route) => void;
  /** Referenced by the disclosure button's `aria-controls`. */
  id: string;
}>) {
  return (
    <div id={id} className="ml-5 space-y-2 border-l border-border pl-2 pt-1">
      {groups.map((group) => (
        <section key={group.id} aria-label={`${group.label} stages`}>
          <h3 className="px-2.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.label}</h3>
          <ul className="space-y-0.5">
            {group.stages.map((stage) => (
              <StageEntry key={stage.id} stage={stage} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
