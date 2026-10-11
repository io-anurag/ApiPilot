import type { CoverageDimensionKind, CoveragePriority, CoveragePriorityFactor, CoverageState } from "@apipilot/shared-domain";

/**
 * Coverage-gap prioritization (FR-028 to FR-030). A transparent additive heuristic over declared
 * contract facts and run outcomes; it is *not* a security assessment. Inputs that do not exist
 * (cross-run failure history) are omitted rather than guessed.
 *
 *   score = state + kind + method + security + complexity
 *
 *   state       executed-failed 4 | not-covered 3 | inconclusive, stale, generated-not-executed 2
 *   kind        operation 2 | response-code 1 | everything else 0
 *   method      DELETE 3 | PUT, PATCH 2 | POST 1 | other 0     (mutating operations matter more)
 *   security    +2 when the specification declares a security requirement for the operation
 *   complexity  min(2, floor(constrained fields / 5))
 *
 *   high >= 7, medium >= 3, otherwise low.
 *
 * Ties break by operation key, then gap kind, so ordering is stable across runs.
 */
export const HIGH_PRIORITY_SCORE = 7;
export const MEDIUM_PRIORITY_SCORE = 3;

const STATE_POINTS: Partial<Record<CoverageState, number>> = {
  "executed-failed": 4,
  "not-covered": 3,
  inconclusive: 2,
  stale: 2,
  "generated-not-executed": 2,
};

const KIND_POINTS: Partial<Record<CoverageDimensionKind | "mixed", number>> = { operation: 2, "response-code": 1 };

const METHOD_POINTS: Record<string, number> = { DELETE: 3, PUT: 2, PATCH: 2, POST: 1 };

export interface PriorityContext {
  method: string;
  securityDeclared: boolean;
  /** Count of fields carrying declared constraints (enum, format, bounds). */
  constrainedFieldCount: number;
}

export interface PriorityAssessment {
  score: number;
  priority: CoveragePriority;
  factors: CoveragePriorityFactor[];
}

export function priorityForScore(score: number): CoveragePriority {
  if (score >= HIGH_PRIORITY_SCORE) return "high";
  if (score >= MEDIUM_PRIORITY_SCORE) return "medium";
  return "low";
}

export function assessGap(context: PriorityContext, kind: CoverageDimensionKind | "mixed", state: CoverageState): PriorityAssessment {
  const factors: CoveragePriorityFactor[] = [];
  const push = (factor: string, points: number, explanation: string): void => {
    if (points > 0) factors.push({ factor, points, explanation });
  };
  push("state", STATE_POINTS[state] ?? 0, `The requirement is ${state.replaceAll("-", " ")}.`);
  push("kind", KIND_POINTS[kind] ?? 0, kind === "operation" ? "The whole operation lacks coverage." : "A documented response lacks coverage.");
  push("method", METHOD_POINTS[context.method.toUpperCase()] ?? 0, `${context.method.toUpperCase()} changes server state.`);
  push("security", context.securityDeclared ? 2 : 0, "The specification declares a security requirement for this operation.");
  push("complexity", Math.min(2, Math.floor(context.constrainedFieldCount / 5)), "The contract declares many constrained fields.");
  const score = factors.reduce((sum, f) => sum + f.points, 0);
  return { score, priority: priorityForScore(score), factors };
}
