import type {
  Prerequisite,
  ScenarioOutcomeKind,
  ScenarioResult,
  SecurityCategory,
  SecurityFinding,
  SecurityOverview,
  SecurityReport,
  SecurityRun,
  Severity,
} from "@apipilot/shared-domain";
import { SCENARIO_OUTCOME_KINDS, SEVERITIES, TAXONOMY_EDITION } from "@apipilot/shared-domain";

/**
 * The content of a security assessment report (specs/057 FR-061, FR-062, research R15). It is a pure function of the
 * records it is given and an injected time, so identical records give an identical report. It carries the summary,
 * the category coverage and outcomes, the findings with their status and remediation, the specification revision,
 * the profile name and tier of every included run, the taxonomy edition, what was **not** covered and why, and the
 * limits of what was tested. It holds no credential, no request or response and no evidence: only identifiers,
 * counts, outcomes, redacted observed summaries and static text. A report works with no specification loaded,
 * because everything it states comes from retained work.
 */

export const REPORT_LIMITS_STATEMENT =
  "Specification analysis does not prove runtime vulnerabilities: an observation is a question to investigate, not a defect. " +
  "A finding is the result of requests actually sent to the target named in each run, judged against conditions the scenario stated beforehand. " +
  "A passed scenario shows only that those conditions held for the requests sent. It does not show that an operation or a category is secure. " +
  "Scenarios that were blocked, not run, errored or inconclusive were not judged and are not counted as passed.";

export interface ReportScenarioRecord {
  readonly id: string;
  readonly categoryId: string;
  readonly assessmentLabel: string;
  readonly prerequisites: readonly Prerequisite[];
}

export interface ReportInput {
  readonly generatedAt: string;
  readonly overview: SecurityOverview;
  readonly scenarios: readonly ReportScenarioRecord[];
  /** The runs the report covers. */
  readonly runs: readonly SecurityRun[];
  /** The results of those runs only. */
  readonly results: readonly ScenarioResult[];
  readonly findings: readonly SecurityFinding[];
  readonly categories: readonly SecurityCategory[];
}

const zeroOutcomes = (): Record<ScenarioOutcomeKind, number> => Object.fromEntries(SCENARIO_OUTCOME_KINDS.map((kind) => [kind, 0])) as Record<ScenarioOutcomeKind, number>;
const severityRank = (severity: Severity) => SEVERITIES.indexOf(severity);

function assessmentLabelOf(scenarios: readonly ReportScenarioRecord[]): string | undefined {
  const labels = [...new Set(scenarios.map((scenario) => scenario.assessmentLabel))].sort();
  if (labels.length === 0) return undefined;
  return labels.length === 1 ? labels[0] : `${labels.length} assessments: ${labels.join("; ")}`;
}

/** The kinds of prerequisite a category's scenarios still need, as plain words, for the "not covered" reasons. */
function neededKinds(scenarios: readonly ReportScenarioRecord[]): string[] {
  const kinds = new Set<string>();
  for (const scenario of scenarios) for (const prerequisite of scenario.prerequisites) kinds.add(prerequisite.id.startsWith("unsupported:") ? "something this version cannot supply" : prerequisite.kind);
  return [...kinds].sort();
}

export function summarizeReport(input: ReportInput): SecurityReport {
  const byScenarioCategory = new Map(input.scenarios.map((scenario) => [scenario.id, scenario.categoryId]));
  const outcomesByCategory = new Map<string, Record<ScenarioOutcomeKind, number>>();
  for (const result of input.results) {
    const category = byScenarioCategory.get(result.scenarioId);
    if (!category) continue;
    const counts = outcomesByCategory.get(category) ?? zeroOutcomes();
    counts[result.outcome] += 1;
    outcomesByCategory.set(category, counts);
  }

  const categoryCoverage: SecurityReport["categoryCoverage"] = input.categories.map((category) => ({
    categoryId: category.id,
    name: category.name,
    supportLevel: category.supportLevel,
    scenarios: input.scenarios.filter((scenario) => scenario.categoryId === category.id).length,
    outcomes: outcomesByCategory.get(category.id) ?? zeroOutcomes(),
  }));

  const notCovered: SecurityReport["notCovered"] = [];
  for (const category of input.categories) {
    const own = input.scenarios.filter((scenario) => scenario.categoryId === category.id);
    const ran = Object.values(outcomesByCategory.get(category.id) ?? {}).reduce((sum, count) => sum + count, 0);
    const note = category.limitationNote ? ` ${category.limitationNote}` : "";
    if (!category.executable) {
      notCovered.push({ categoryId: category.id, reason: `This category cannot be executed in this version, so no request is sent for it.${note}` });
    } else if (own.length === 0) {
      notCovered.push({ categoryId: category.id, reason: `No scenario was generated for this category.${note}` });
    } else if (ran === 0) {
      const needs = neededKinds(own);
      notCovered.push({
        categoryId: category.id,
        reason: `${own.length} scenario${own.length === 1 ? " exists" : "s exist"} but none was run in the included runs.${needs.length > 0 ? ` They need: ${needs.join(", ")}.` : ""}`,
      });
    }
  }

  const findings = [...input.findings].sort((a, b) => severityRank(b.severity.current) - severityRank(a.severity.current) || a.id.localeCompare(b.id));
  const runs = [...input.runs]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
    .map((run) => ({ id: run.id, startedAt: run.startedAt, status: run.status, profileName: run.profileSummary.profileName, tier: run.profileSummary.tier, baseUrl: run.profileSummary.baseUrl }));

  const label = assessmentLabelOf(input.scenarios);
  return {
    generatedAt: input.generatedAt,
    ...(label ? { assessmentLabel: label } : {}),
    ...(input.overview.specificationRevision ? { specificationRevision: input.overview.specificationRevision } : {}),
    taxonomyEdition: TAXONOMY_EDITION,
    overview: input.overview,
    categoryCoverage,
    findings,
    runs,
    notCovered,
    limitsStatement: REPORT_LIMITS_STATEMENT,
  };
}
