import type { ScenarioResult, SecurityFinding, SecurityReport, SecurityRun } from "@apipilot/shared-domain";
import { SecurityLabError, invalidRequest, runNotFound } from "../errors";
import { listCategories } from "../registry/categories";
import { buildOverview, type OverviewContext } from "./overview";
import { summarizeReport, type ReportScenarioRecord } from "./summarizeReport";

/**
 * Gathers the retained records for a report and hands them to the pure summary (specs/057 FR-061, FR-062). It reads
 * retained work only (plus the specification revision when one is loaded), so a report can be produced after the
 * session expired and with no specification loaded. `runIds` narrows the report to some runs; without it every
 * retained run is included.
 */

export interface ReportContext extends OverviewContext {
  readonly now: () => Date;
}

export function parseRunIds(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") throw invalidRequest("'runIds' must be a comma-separated list of run ids.");
  const ids = raw.split(",").map((id) => id.trim()).filter((id) => id !== "");
  if (ids.length === 0 || ids.length > 200) throw invalidRequest("'runIds' must name between 1 and 200 runs.");
  return [...new Set(ids)];
}

export function buildReport(context: ReportContext, runIds: readonly string[] | undefined): SecurityReport {
  const { repo, ownerId } = context.scenario;
  const heads = repo.listHeads(ownerId, {});
  const allRuns = context.runs.listRuns(ownerId);
  const allFindings = context.findings.listAll(ownerId);
  if (heads.length === 0 && allRuns.length === 0 && allFindings.length === 0) {
    throw new SecurityLabError("nothing_to_report", "There is nothing to report yet. Generate scenarios, run them, or analyze a specification first.");
  }

  let runs: SecurityRun[] = allRuns;
  if (runIds) {
    const known = new Map(allRuns.map((run) => [run.id, run]));
    runs = runIds.map((id) => {
      const run = known.get(id);
      if (!run) throw runNotFound(id);
      return run;
    });
  }
  const included = new Set(runs.map((run) => run.id));
  const results: ScenarioResult[] = runs.flatMap((run) => context.runs.listResults(ownerId, run.id));
  const findings: SecurityFinding[] = runIds
    ? allFindings.filter((finding) => finding.occurrences.some((occurrence) => included.has(occurrence.runId)))
    : allFindings;

  const scenarios: ReportScenarioRecord[] = heads.map((head) => ({
    id: head.id,
    categoryId: head.categoryId,
    assessmentLabel: head.assessmentLabel,
    prerequisites: repo.getVersion(ownerId, head.id, head.currentVersion)?.content.prerequisites ?? [],
  }));

  return summarizeReport({
    generatedAt: context.now().toISOString(),
    overview: buildOverview(context),
    scenarios,
    runs,
    results,
    findings,
    categories: listCategories(),
  });
}
