import { useEffect, useState } from "react";
import type { ChainPlanSummary, ChainRunSummary } from "@apipilot/shared-domain";
import { chainRunsClient } from "../../services/requestChainClient";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { Skeleton } from "../Skeleton";
import { StatusBadge, type StatusTone } from "../StatusBadge";
import { formatDateTimeUtc } from "../../dateTime";

/** Plans whose runs are read for the list: there is no cross-plan runs read, so the most recently updated ones stand in (specs/047 tasks T027). */
export const RECENT_RUNS_PLAN_LIMIT = 10;
const RECENT_RUNS_SHOWN = 8;

const STATUS: Record<ChainRunSummary["status"], { label: string; tone: StatusTone }> = {
  "in-progress": { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

interface Row {
  run: ChainRunSummary;
  planId: string;
  planName: string;
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; rows: Row[] };

/**
 * The entry screen's recent runs across plans (specs/047-unified-performance-tab FR-002). The backend
 * lists runs per plan, so this reads the runs of the most recently updated plans and merges them by start
 * time; a plan whose runs cannot be read is skipped, and the list says so only when none could be.
 * Each run opens on its plan's Run step with that run's report.
 */
export function RecentRuns({ plans, onOpenRun, busy = false }: Readonly<{ plans: readonly ChainPlanSummary[]; onOpenRun: (planId: string, runId: string) => void; busy?: boolean }>) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const recent = [...plans].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, RECENT_RUNS_PLAN_LIMIT);
    void Promise.all(recent.map((plan) => chainRunsClient(plan.id).fetchRuns().then((result) => ({ plan, result })))).then((outcomes) => {
      if (cancelled) return;
      const readable = outcomes.filter((outcome) => outcome.result.ok);
      if (recent.length > 0 && readable.length === 0) {
        const failed = outcomes.find((outcome) => !outcome.result.ok);
        setState({ kind: "error", message: failed && !failed.result.ok ? failed.result.message : "The runs could not be read." });
        return;
      }
      const rows = readable
        .flatMap(({ plan, result }) => (result.ok ? result.runs.map((run) => ({ run, planId: plan.id, planName: plan.name })) : []))
        .sort((a, b) => (a.run.startedAt < b.run.startedAt ? 1 : a.run.startedAt > b.run.startedAt ? -1 : 0))
        .slice(0, RECENT_RUNS_SHOWN);
      setState({ kind: "ready", rows });
    });
    return () => {
      cancelled = true;
    };
  }, [plans]);

  if (state.kind === "loading") {
    return (
      <div role="status" aria-label="Loading recent runs">
        <Skeleton className="h-16 w-full rounded-xl bg-surface-strong" />
      </div>
    );
  }
  if (state.kind === "error") return <ErrorState message="Recent runs could not be loaded." detail={state.message} testId="recent-runs-error" />;
  if (state.rows.length === 0) return <EmptyState message="No runs yet." description="A run you start from a plan appears here." testId="recent-runs-empty" />;
  return (
    <div className={TABLE_STYLES.scroll} data-testid="recent-runs">
      <table className={TABLE_STYLES.table}>
        <caption className="sr-only">Recent runs</caption>
        <thead>
          <tr>
            <th scope="col" className={TABLE_STYLES.th}>Plan</th>
            <th scope="col" className={TABLE_STYLES.th}>Started</th>
            <th scope="col" className={TABLE_STYLES.th}>Environment</th>
            <th scope="col" className={TABLE_STYLES.th}>Status</th>
            <th scope="col" className={TABLE_STYLES.th}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map(({ run, planId, planName }) => (
            <tr key={run.id}>
              <td className={`${TABLE_STYLES.td} font-medium`}>{planName}</td>
              <td className={TABLE_STYLES.td}>{formatDateTimeUtc(run.startedAt)}</td>
              <td className={TABLE_STYLES.td}>{run.environment.name}</td>
              <td className={TABLE_STYLES.td}>
                <StatusBadge label={STATUS[run.status].label} tone={STATUS[run.status].tone} />
              </td>
              <td className={`${TABLE_STYLES.td} text-right`}>
                <button type="button" className={BUTTON_STYLES.primary} aria-label={`Open the run of ${planName} started ${formatDateTimeUtc(run.startedAt)}`} disabled={busy} onClick={() => onOpenRun(planId, run.id)}>
                  Open run
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
