import { useEffect, useState } from "react";
import type { ChainPlanSummary, ChainRunSummary } from "@apipilot/shared-domain";
import { chainRunsClient } from "../../services/requestChainClient";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";
import { StatusBadge, type StatusTone } from "../StatusBadge";

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
  planName: string;
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; rows: Row[] };

const formatStarted = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

/**
 * The entry screen's recent runs across plans (specs/047-unified-performance-tab FR-002). The backend
 * lists runs per plan, so this reads the runs of the most recently updated plans and merges them by start
 * time; a plan whose runs cannot be read is skipped, and the list says so only when none could be.
 */
export function RecentRuns({ plans }: Readonly<{ plans: readonly ChainPlanSummary[] }>) {
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
        .flatMap(({ plan, result }) => (result.ok ? result.runs.map((run) => ({ run, planName: plan.name })) : []))
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
        <Skeleton className="h-16 w-full rounded bg-surface-strong" />
      </div>
    );
  }
  if (state.kind === "error") return <ErrorState message="Recent runs could not be loaded." detail={state.message} testId="recent-runs-error" />;
  if (state.rows.length === 0) return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">No runs yet. A run you start from a plan appears here.</p>;
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border bg-surface" data-testid="recent-runs">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">Recent runs</caption>
        <thead className="border-b border-border text-xs uppercase text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Plan</th>
            <th scope="col" className="px-3 py-2 font-medium">Started</th>
            <th scope="col" className="px-3 py-2 font-medium">Environment</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {state.rows.map(({ run, planName }) => (
            <tr key={run.id}>
              <td className="px-3 py-2 font-medium text-text-primary">{planName}</td>
              <td className="px-3 py-2 text-muted">{formatStarted(run.startedAt)}</td>
              <td className="px-3 py-2">{run.environment.name}</td>
              <td className="px-3 py-2">
                <StatusBadge label={STATUS[run.status].label} tone={STATUS[run.status].tone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
