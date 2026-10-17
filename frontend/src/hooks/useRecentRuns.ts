import { useEffect, useState } from "react";
import {
  RECENT_RUN_OWNER_LIMIT,
  RECENT_RUNS_SHOWN,
  RUN_WORKFLOW_LABELS,
  importRuns,
  k6Runs,
  mergeRecentRuns,
  performanceRuns,
  type RecentRun,
  type RunWorkflow,
} from "../components/home/homeViewModel";
import { fetchUploadedCollectionRuns, fetchUploadedCollections } from "../services/externalCollectionsClient";
import { chainRunsClient, listPlans } from "../services/requestChainClient";
import { userScriptClient } from "../services/userScriptClient";

export interface RecentRunsState {
  /** `loading` until every source has settled; `ready` after, even when some could not be read. */
  readonly status: "idle" | "loading" | "ready";
  readonly runs: readonly RecentRun[];
  /** Sources that could not be read, named in words so the list never silently under-reports. */
  readonly unreadable: readonly string[];
}

const IDLE: RecentRunsState = { status: "idle", runs: [], unreadable: [] };

type SourceResult = { workflow: RunWorkflow; rows: RecentRun[] } | { workflow: RunWorkflow; rows: null };

const newestFirst = <T,>(items: readonly T[], at: (item: T) => string) =>
  [...items].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a))).slice(0, RECENT_RUN_OWNER_LIMIT);

/** Import & Run: the runs of the ten most recently added collections. */
async function readImport(): Promise<SourceResult> {
  const list = await fetchUploadedCollections();
  if (!list.ok) return { workflow: "import", rows: null };
  const collections = newestFirst(list.uploadedCollections, (collection) => collection.createdAt);
  const results = await Promise.all(collections.map((collection) => fetchUploadedCollectionRuns(collection.id)));
  if (results.some((result) => !result.ok)) return { workflow: "import", rows: null };
  return {
    workflow: "import",
    rows: results.flatMap((result, index) => (result.ok ? importRuns(collections[index].name, result.runs) : [])),
  };
}

/** Performance: the runs of the ten most recently updated plans (retired legacy runs are not included). */
async function readPerformance(): Promise<SourceResult> {
  const list = await listPlans();
  if (!list.ok) return { workflow: "performance", rows: null };
  const plans = newestFirst(list.plans, (plan) => plan.updatedAt);
  const results = await Promise.all(plans.map((plan) => chainRunsClient(plan.id).fetchRuns()));
  if (results.some((result) => !result.ok)) return { workflow: "performance", rows: null };
  return {
    workflow: "performance",
    rows: results.flatMap((result, index) => (result.ok ? performanceRuns(plans[index].id, plans[index].name, result.runs) : [])),
  };
}

/** Run k6 Script: every run the session holds. */
async function readK6(): Promise<SourceResult> {
  const result = await userScriptClient.fetchAllRuns();
  return result.ok ? { workflow: "k6", rows: k6Runs(result.runs) } : { workflow: "k6", rows: null };
}

/**
 * The runs Import & Run, Performance and Run k6 Script already hold for this session, merged
 * newest first for Home (AP-054 FR-020). It reads only while `active` (Home is on screen), once
 * per visit, never polls, and a source that fails is skipped and named rather than hiding the
 * others. Nothing is stored: every row is a view of an existing record.
 */
export function useRecentRuns(active: boolean): RecentRunsState {
  const [state, setState] = useState<RecentRunsState>(IDLE);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const rows: RecentRun[] = [];
    const unreadable: string[] = [];
    setState({ status: "loading", runs: [], unreadable: [] });
    const sources: ReadonlyArray<readonly [RunWorkflow, Promise<SourceResult>]> = [
      ["import", readImport()],
      ["performance", readPerformance()],
      ["k6", readK6()],
    ];
    let settled = 0;
    for (const [workflow, source] of sources) {
      void source
        .catch((): SourceResult => ({ workflow, rows: null }))
        .then((result) => {
          if (cancelled) return;
          settled += 1;
          if (result.rows === null) unreadable.push(RUN_WORKFLOW_LABELS[result.workflow]);
          else rows.push(...result.rows);
          setState({
            status: settled === sources.length ? "ready" : "loading",
            runs: mergeRecentRuns(rows, RECENT_RUNS_SHOWN),
            unreadable: [...unreadable],
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [active]);

  return active ? state : IDLE;
}
