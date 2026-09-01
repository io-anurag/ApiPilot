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
  "success" | "unavailable" | "timeout" | "invalid-response";

export interface EnhancementResult {
  enhancedTestModel: TestModel;
  aiCandidates: AICandidateOutcomes;
  aiProviderOutcome: AIProviderOutcome;
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
  requestId: string;
}
