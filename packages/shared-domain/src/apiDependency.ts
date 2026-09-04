import type { AIErrorCategory, AIProviderMode } from "./aiProvider";

/** Where a consumer reads a field from its request (data-model.md: FieldRef). */
export type DependencyFieldLocation = "path" | "query" | "header" | "body";

/** Identifies one field on one side of a relationship (data-model.md: FieldRef). */
export interface FieldRef {
  operationPath: string;
  operationMethod: string;
  /** Dotted field path (e.g. "id", "user.id"). */
  field: string;
  /** Present only on the consumer side. */
  location?: DependencyFieldLocation;
}

/** The five deterministic signals computable from the current ApiModel (research.md). */
export interface DeterministicDependencyEvidence {
  nameMatch: boolean;
  typeMatch: boolean;
  formatMatch: boolean;
  resourceRelationship: boolean;
  tagAlignment: boolean;
}

/** Present when the AI-assisted pass reported or corroborated a relationship. */
export interface AIDependencyCorroboration {
  aiModel: string;
  aiProvider: AIProviderMode;
  /** The model's own reported confidence (0-1). */
  aiConfidence: number;
  aiRationale: string;
}

/** Constitution XV: relationships are never treated as more than this classification implies. */
export type DependencyConfidence = "CONFIRMED" | "LIKELY" | "POSSIBLE";

/** Which pass(es) found this relationship (FR-006a). */
export type DependencySource = "deterministic" | "ai" | "deterministic+ai";

/** A candidate connection between one operation's response field and another's request field. */
export interface ApiDependencyRelationship {
  id: string;
  producer: FieldRef;
  consumer: FieldRef;
  confidence: DependencyConfidence;
  source: DependencySource;
  /** Present whenever `source` includes "deterministic". */
  evidence?: DeterministicDependencyEvidence;
  /** Present whenever `source` includes "ai". */
  aiCorroboration?: AIDependencyCorroboration;
  /** Names the specific evidence signals or AI rationale used (FR-007). */
  explanation: string;
}

/** The full analysis output before workflow assembly. */
export interface ApiDependencyGraph {
  relationships: ApiDependencyRelationship[];
}

/** One inter-step hand-off inside a generated workflow. */
export interface WorkflowVariable {
  name: string;
  producerStepIndex: number;
  producerField: string;
  consumerStepIndex: number;
  consumerLocation: DependencyFieldLocation;
  consumerField: string;
  relationshipId: string;
}

/** One operation's participation in a workflow. */
export interface WorkflowStep {
  position: number;
  operationPath: string;
  operationMethod: string;
  producesVariableNames: string[];
  consumesVariableNames: string[];
}

/** An ordered sequence of operation steps assembled from CONFIRMED/LIKELY relationships. */
export interface IntegrationWorkflow {
  id: string;
  steps: WorkflowStep[];
  variables: WorkflowVariable[];
  /** Traces the workflow back to the relationships that produced it (FR-022). */
  relationshipIds: string[];
}

/** Why a relationship needs human confirmation before it becomes part of a workflow (FR-012, FR-013a, FR-014). */
export type ManualConfirmationReason =
  "possible-confidence" | "excluded-by-disambiguation" | "chain-length-exceeded";

/** A POSSIBLE relationship, or a disambiguation-excluded relationship, needing human confirmation. */
export interface ManualConfirmationCandidate {
  relationshipId: string;
  reason: ManualConfirmationReason;
  message: string;
}

/** A detected cycle among candidate relationships (FR-014). */
export interface DependencyCycleFinding {
  relationshipIds: string[];
  operations: { path: string; method: string }[];
  message: string;
}

/** What happened to the AI-assisted pass during one analysis run. */
export type DependencyAIOutcome =
  "success" | "unavailable" | "timeout" | "invalid-response" | "skipped" | "partial";

/** The single value the analysis returns and the endpoint serializes. */
export interface DependencyAnalysisResult {
  requestId: string;
  graph: ApiDependencyGraph;
  workflows: IntegrationWorkflow[];
  manualConfirmationCandidates: ManualConfirmationCandidate[];
  cycles: DependencyCycleFinding[];
  aiOutcome: DependencyAIOutcome;
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
}

/** Distinguishable reasons the analysis endpoint refuses to return a result. */
export type DependencyAnalysisFailureCode = "invalid_request" | "analysis_timeout";

/** A candidate relationship suggested by the AI-assisted pass, before validation (research.md). */
export interface AIDependencyCandidate {
  candidateId: string;
  producer: FieldRef;
  consumer: FieldRef;
  rationale: string;
  confidence: number;
}

/** Distinguishable reasons an AI dependency candidate was rejected (mirrors AIValidationFindingCode). */
export type AIDependencyValidationFindingCode =
  "invalid-shape" | "operation-not-found" | "field-not-found" | "duplicate";

export interface AIDependencyValidationFinding {
  code: AIDependencyValidationFindingCode;
  message: string;
  candidateId: string;
  path?: string;
}

export interface AIDependencyRejectedCandidate {
  candidate: unknown;
  findings: AIDependencyValidationFinding[];
}
