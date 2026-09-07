import type {
  Assertion,
  GeneratedRequest,
  ScenarioCategory,
  TestModel,
} from "./testModel";
import type { AIErrorCategory } from "./aiProvider";

export type AIScenarioTargetLocation = "path" | "query" | "header" | "body";

export interface AIScenarioCandidate {
  candidateId: string;
  operationPath: string;
  operationMethod: string;
  category: ScenarioCategory;
  targetLocation?: AIScenarioTargetLocation;
  targetField?: string;
  request: GeneratedRequest;
  assertions: Assertion[];
  rationale: string;
  confidence: number;
  assumptions: string[];
}

export type AIValidationFindingCode =
  | "invalid-shape"
  | "operation-not-found"
  | "method-not-found"
  | "field-not-found"
  | "schema-not-found"
  | "undocumented-status-code"
  | "unsupported-category"
  | "missing-rationale"
  | "low-confidence"
  | "duplicate";

export interface AIValidationFinding {
  code: AIValidationFindingCode;
  message: string;
  candidateId: string;
  path?: string;
  executable: boolean;
}

export interface AIRejectedCandidate {
  candidate: unknown;
  findings: AIValidationFinding[];
}

export interface AINonExecutableCandidate {
  candidate: AIScenarioCandidate;
  findings: AIValidationFinding[];
}

export interface AIAddedCandidate {
  candidate: AIScenarioCandidate;
  scenarioId: string;
}

export interface AIDeduplicatedCandidate {
  candidate: AIScenarioCandidate;
  retainedScenarioId: string;
  duplicateOfCandidateIds: string[];
}

export interface AICandidateOutcomes {
  added: AIAddedCandidate[];
  deduplicated: AIDeduplicatedCandidate[];
  rejected: AIRejectedCandidate[];
  nonExecutable: AINonExecutableCandidate[];
}

export type AIProviderOutcome =
  "success" | "unavailable" | "timeout" | "invalid-response" | "partial";

export interface EnhancementResult {
  enhancedTestModel: TestModel;
  aiCandidates: AICandidateOutcomes;
  aiProviderOutcome: AIProviderOutcome;
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
  requestId: string;
  /**
   * Present only when the run was refused before any inference was attempted, because a single
   * unit's projected cost could not fit the per-request budget
   * (specs/014-ai-batching-policy FR-013).
   *
   * Distinct from every `aiErrorCategory`: nothing failed, and nothing was tried. The stage uses
   * these figures to tell the user what was projected versus what was allowed, in human-readable
   * durations, so a refusal is actionable rather than merely negative (FR-014).
   */
  notViable?: {
    projectedMs: number;
    budgetMs: number;
  };
  /**
   * Present only when the run's wall-clock ceiling elapsed before every unit had been started
   * (specs/014-ai-batching-policy FR-010, contracts/run-budget.md).
   *
   * Distinct from `aiErrorCategory`: the units that ran are unaffected and their scenarios are
   * retained, and the ones recorded `not-attempted` were never sent. `notStartedCount` is what
   * makes the shortfall reportable — the stage can say how much of the plan the ceiling permitted
   * instead of presenting a truncated run as a complete one.
   */
  runBudgetExhausted?: {
    budgetMs: number;
    notStartedCount: number;
  };
}
