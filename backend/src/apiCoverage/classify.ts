import type { CoverageCause, CoverageCheckScope, CoverageEvidenceRef, CoverageState, ScenarioVerdict } from "@apipilot/shared-domain";
import type { EvidenceCheck, ScenarioEvidence } from "./evidence";

/** A scenario mapped to the requirement being classified, with the checks that decide it. */
export interface MappedScenario {
  scenarioId: string;
  scope: CoverageCheckScope;
  responseCode?: string;
}

export interface Classification {
  state: CoverageState;
  cause?: CoverageCause;
  reason: string;
  evidence: CoverageEvidenceRef[];
  /** What every mapped scenario established; the counts sum to the number of mapped scenarios. */
  tally: { passed: number; failed: number; inconclusive: number; notExecuted: number };
  /** Stale only: reserved, never produced by any current rule. */
  staleReason?: string;
  staleSince?: string;
  reExecutionRequired?: boolean;
}

type Verdict = CoverageEvidenceRef["verdict"];

export interface VerdictResult {
  verdict: Verdict;
  cause?: CoverageCause;
  note?: string;
}

/** The checks of `evidence` that bear on a requirement of the given scope. */
export function relevantChecks(evidence: ScenarioEvidence, scope: CoverageCheckScope, responseCode?: string): EvidenceCheck[] {
  if (scope === "status") return evidence.checks.filter((c) => c.kind === "status-code");
  if (scope === "status-code") {
    return evidence.checks.filter((c) => c.kind === "status-code" && c.expectedStatusCode === responseCode);
  }
  if (scope === "schema-conformance") return evidence.checks.filter((c) => c.kind === "schema-conformance");
  return evidence.checks;
}

/**
 * What one execution result establishes about one requirement. A successful response alone never
 * verifies anything: at least one relevant check must have been evaluated, and every relevant
 * check must have passed (FR-005). Only an evaluated, failed relevant check is `failed`; a
 * transport error, an unevaluated check or an edited request is `inconclusive` with its cause.
 */
export function verdictFor(mapped: Pick<MappedScenario, "scope" | "responseCode">, evidence: ScenarioEvidence): VerdictResult {
  if (evidence.stale) return { verdict: "stale", note: evidence.staleReason ?? "evidence requires revalidation" };
  if (evidence.edited) return { verdict: "inconclusive", cause: "request-edited", note: "the request was edited before the run" };
  const checks = relevantChecks(evidence, mapped.scope, mapped.responseCode);
  if (checks.some((c) => c.outcome === "failed")) return { verdict: "failed", cause: "assertion-failed", note: "a relevant check failed" };
  if (evidence.noResponse) return { verdict: "inconclusive", cause: "transport-error", note: "no response was received" };
  if (checks.length === 0) {
    return mapped.scope === "any" && evidence.outcome === "failed"
      ? { verdict: "failed", cause: "assertion-failed", note: "the request failed" }
      : { verdict: "inconclusive", cause: "no-relevant-check", note: "no relevant check was evaluated" };
  }
  if (checks.some((c) => c.outcome === "not-evaluated")) {
    return { verdict: "inconclusive", cause: "check-not-evaluated", note: "a relevant check could not be evaluated" };
  }
  if (mapped.scope === "any" && evidence.outcome === "failed") return { verdict: "failed", cause: "assertion-failed", note: "the request failed" };
  return { verdict: "verified" };
}

/** The verdict of a whole scenario (every defined check), or `not-executed` when no evidence exists. */
export function scenarioVerdictOf(evidence: ScenarioEvidence | undefined): { verdict: ScenarioVerdict; cause?: CoverageCause } {
  if (!evidence) return { verdict: "not-executed" };
  const { verdict, cause } = verdictFor({ scope: "any" }, evidence);
  if (verdict === "verified") return { verdict: "passed" };
  if (verdict === "failed") return { verdict: "failed", ...(cause !== undefined ? { cause } : {}) };
  return { verdict: "inconclusive", ...(cause !== undefined ? { cause } : {}) };
}

const VERDICT_ORDER: Record<Verdict, number> = { failed: 0, verified: 1, inconclusive: 2, stale: 3 };
const MAX_EVIDENCE_REFS = 3;
/** Which reason an unexecuted requirement reports when several mapped scenarios differ: the most specific first. */
const MISSING_CAUSE_ORDER: readonly CoverageCause[] = ["blocked-by-dependency", "run-cancelled", "not-reached", "not-in-selected-run", "never-run"];

/**
 * Classifies one requirement from the scenarios mapped to it (data-model.md "State precedence"):
 * none mapped = not covered; mapped but no attributable executed result = generated, not
 * executed; otherwise failure outranks verification, which outranks inconclusive (D-7). The tally
 * keeps every mapped scenario's outcome visible so a failed state never hides passes.
 */
export function classifyRequirement(
  mapped: readonly MappedScenario[],
  evidenceOf: (scenarioId: string) => ScenarioEvidence | undefined,
  missingCauseOf: (scenarioId: string) => CoverageCause = () => "never-run",
): Classification {
  const tally = { passed: 0, failed: 0, inconclusive: 0, notExecuted: 0 };
  if (mapped.length === 0) {
    return { state: "not-covered", reason: "No generated scenario targets this requirement.", evidence: [], tally };
  }
  const refs: CoverageEvidenceRef[] = [];
  const missingCauses: CoverageCause[] = [];
  const staleness: { reason?: string; since?: string } = {};
  for (const m of mapped) {
    const evidence = evidenceOf(m.scenarioId);
    if (!evidence) {
      tally.notExecuted += 1;
      missingCauses.push(missingCauseOf(m.scenarioId));
      continue;
    }
    const { verdict, cause, note } = verdictFor(m, evidence);
    if (verdict === "verified") tally.passed += 1;
    else if (verdict === "failed") tally.failed += 1;
    else tally.inconclusive += 1;
    if (verdict === "stale") {
      staleness.reason ??= evidence.staleReason;
      staleness.since ??= evidence.staleSince;
    }
    refs.push({
      runId: evidence.runId,
      runKind: evidence.runKind,
      scenarioId: evidence.scenarioId,
      ...(evidence.itemId !== undefined ? { itemId: evidence.itemId } : {}),
      startedAt: evidence.startedAt,
      outcome: evidence.outcome,
      verdict,
      ...(cause !== undefined ? { cause } : {}),
      ...(note !== undefined ? { note } : {}),
    });
  }
  if (refs.length === 0) {
    const cause = MISSING_CAUSE_ORDER.find((c) => missingCauses.includes(c)) ?? "never-run";
    return {
      state: "generated-not-executed",
      cause,
      reason: "A scenario exists, but no qualifying execution result is attributable to it.",
      evidence: [],
      tally,
    };
  }
  refs.sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.scenarioId.localeCompare(b.scenarioId));
  const bounded = refs.slice(0, MAX_EVIDENCE_REFS);
  const verdicts = new Set(refs.map((r) => r.verdict));
  if (verdicts.has("failed")) {
    return { state: "executed-failed", cause: "assertion-failed", reason: "An executed scenario failed a relevant check.", evidence: bounded, tally };
  }
  if (verdicts.has("verified")) {
    return { state: "verified", reason: "A scenario ran and every relevant check it evaluated passed.", evidence: bounded, tally };
  }
  if (verdicts.size === 1 && verdicts.has("stale")) {
    return {
      state: "stale",
      reason: staleness.reason ?? "The available evidence requires revalidation.",
      evidence: bounded,
      tally,
      ...(staleness.reason !== undefined ? { staleReason: staleness.reason } : {}),
      ...(staleness.since !== undefined ? { staleSince: staleness.since } : {}),
      reExecutionRequired: true,
    };
  }
  const firstInconclusive = refs.find((r) => r.verdict === "inconclusive");
  return {
    state: "inconclusive",
    ...(firstInconclusive?.cause !== undefined ? { cause: firstInconclusive.cause } : {}),
    reason: firstInconclusive?.note ? `Execution evidence is insufficient: ${firstInconclusive.note}.` : "Execution evidence is insufficient.",
    evidence: bounded,
    tally,
  };
}
