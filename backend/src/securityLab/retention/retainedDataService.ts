import type { RetainedAssessmentSummary, RetainedDataSummary } from "@apipilot/shared-domain";
import { getSharedConnection } from "../../persistence/connection";
import type { SecurityCredentialRepository } from "../../persistence/securityCredentialRepository";
import type { SecurityEvidenceRepository } from "../../persistence/securityEvidenceRepository";
import type { SecurityFindingRepository } from "../../persistence/securityFindingRepository";
import type { SecurityProfileRepository } from "../../persistence/securityProfileRepository";
import type { SecurityRunRepository } from "../../persistence/securityRunRepository";
import type { SecurityScenarioRepository } from "../../persistence/securityScenarioRepository";
import type { SecurityLabLimits } from "../config";
import { SecurityLabError } from "../errors";

/**
 * Retained-data management (specs/057 FR-051, research R13, R22, contracts/security-lab-api.md "Retained data
 * management"). Retained work (scenarios and every version, runs and results, findings, settings) lives until the
 * engineer deletes it, so deleting must be possible, complete and deliberate: a hard delete in one transaction, a typed
 * confirmation, and a refusal while a run is in progress. Session data (profiles, credentials, evidence) is removed by
 * the session ending, and by "delete everything" for the caller's own session.
 */

export const DELETE_ALL_CONFIRMATION = "DELETE ALL";

export interface RetentionContext {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly limits: SecurityLabLimits;
  readonly scenarios: SecurityScenarioRepository;
  readonly runs: SecurityRunRepository;
  readonly findings: SecurityFindingRepository;
  readonly evidence: SecurityEvidenceRepository;
  readonly profiles: SecurityProfileRepository;
  readonly credentials: SecurityCredentialRepository;
}

const REMOVED_WITH_SESSION = [
  "Target profiles, with their allowed hosts and ports, identities and test data",
  "The credentials you entered for identities",
  "The raw redacted evidence behind results and finding occurrences",
];

const RETAINED = [
  "Scenarios, with every version and the approval each version received",
  "Run results, with a bounded observed summary for each",
  "Findings, with their history and occurrences",
  "The sensitive field names you configured",
];

export function getRetainedData(context: RetentionContext): RetainedDataSummary {
  const byKey = new Map<string, RetainedAssessmentSummary>();
  const entry = (key: string, label?: string): RetainedAssessmentSummary => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const created = { assessmentKey: key, assessmentLabel: label ?? `Assessment ${key.slice(0, 8)}`, scenarios: 0, runs: 0, findings: 0 };
    byKey.set(key, created);
    return created;
  };
  for (const assessment of context.scenarios.listAssessments(context.ownerId)) {
    entry(assessment.assessmentKey, assessment.assessmentLabel).scenarios = assessment.scenarios;
  }
  for (const run of context.runs.listRuns(context.ownerId)) entry(run.assessmentKey).runs += 1;
  for (const counted of context.findings.countsByAssessment(context.ownerId)) entry(counted.assessmentKey).findings = counted.findings;

  const assessments = [...byKey.values()].sort((a, b) => a.assessmentLabel.localeCompare(b.assessmentLabel) || a.assessmentKey.localeCompare(b.assessmentKey));
  return {
    assessments,
    totals: {
      scenarios: assessments.reduce((sum, item) => sum + item.scenarios, 0),
      runs: assessments.reduce((sum, item) => sum + item.runs, 0),
      findings: assessments.reduce((sum, item) => sum + item.findings, 0),
    },
    caps: { maxScenarios: context.limits.retention.maxScenarios, maxRuns: context.limits.retention.maxRuns },
    removedWithSession: REMOVED_WITH_SESSION,
    retained: RETAINED,
  };
}

function refuseWhileRunning(context: RetentionContext, assessmentKey?: string): void {
  const running = context.runs.listRuns(context.ownerId).find((run) => run.status === "in-progress" && (assessmentKey === undefined || run.assessmentKey === assessmentKey));
  if (running) {
    throw new SecurityLabError("execution_in_progress", "A run is in progress. Cancel it or wait for it to finish before deleting.", { runId: running.id });
  }
}

/** Hard-deletes one assessment's retained work, in one transaction, after its label has been typed back. */
export function deleteAssessment(context: RetentionContext, assessmentKey: string, confirm: unknown): void {
  const summary = getRetainedData(context).assessments.find((item) => item.assessmentKey === assessmentKey);
  if (!summary) throw new SecurityLabError("assessment_not_found", `No retained assessment with key '${assessmentKey}' was found.`);
  refuseWhileRunning(context, assessmentKey);
  if (confirm !== summary.assessmentLabel) {
    throw new SecurityLabError("confirmation_mismatch", `Type the assessment's label exactly to delete it: ${summary.assessmentLabel}`, { expected: "assessment label" });
  }
  const runIds = context.runs.listRuns(context.ownerId, assessmentKey).map((run) => run.id);
  getSharedConnection().db.transaction(() => {
    context.evidence.deleteByRuns(runIds);
    context.findings.deleteAssessment(context.ownerId, assessmentKey);
    context.runs.deleteAssessment(context.ownerId, assessmentKey);
    context.scenarios.deleteAssessment(context.ownerId, assessmentKey);
  })();
}

/** Hard-deletes everything this owner retains, and the caller's own session data, after "DELETE ALL" has been typed. */
export function deleteEverything(context: RetentionContext, confirm: unknown): void {
  refuseWhileRunning(context);
  if (confirm !== DELETE_ALL_CONFIRMATION) {
    throw new SecurityLabError("confirmation_mismatch", `Type ${DELETE_ALL_CONFIRMATION} exactly to delete everything.`, { expected: DELETE_ALL_CONFIRMATION });
  }
  getSharedConnection().db.transaction(() => {
    context.evidence.deleteByOwner(context.ownerId);
    context.findings.deleteOwner(context.ownerId);
    context.runs.deleteOwner(context.ownerId);
    context.scenarios.deleteOwner(context.ownerId);
    context.evidence.deleteBySession(context.sessionId);
    context.credentials.deleteBySession(context.sessionId);
    context.profiles.deleteBySession(context.sessionId);
  })();
}
