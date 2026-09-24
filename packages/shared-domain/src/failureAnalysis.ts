import type { AIErrorCategory, AIProviderMode } from "./aiProvider";

/**
 * AI Failure Analysis domain contracts (AP-031, specs/030-ai-failure-analysis data-model.md).
 *
 * Framework-agnostic per constitution VIII/X. An analysis explains one failed
 * `UploadedRequestResult`, addressed by `(runId, resultIndex)`. Evidence is extracted
 * deterministically and only cited by the AI; the AI never writes evidence text (research D4).
 */

export type FailureCause =
  | "specification-mismatch"
  | "environment-issue"
  | "downstream-service-issue";

export type InsufficientEvidenceReason =
  | "model-reported"
  | "below-confidence-threshold"
  | "no-valid-evidence-cited";

export type FailureAnalysisConclusion =
  | { kind: "likely-cause"; cause: FailureCause; confidence: number }
  | { kind: "insufficient-evidence"; reason: InsufficientEvidenceReason; confidence?: number };

/** Fixed emission order (research D4); `id`s `E1..En` follow it. */
export type FailureEvidenceKind =
  | "failure-category"
  | "response-status"
  | "response-time"
  | "test-outcome"
  | "request-line"
  | "request-headers"
  | "request-body-excerpt"
  | "response-headers"
  | "response-body-excerpt"
  | "request-edited"
  | "documented-responses"
  | "scenario-expectation"
  | "upstream-step-outcome"
  | "omitted-for-capacity";

/** One deterministic, already-redacted fact offered to the model. */
export interface FailureEvidence {
  id: string;
  kind: FailureEvidenceKind;
  /** Keeps runtime observations distinct from specification-derived facts (constitution preamble). */
  source: "run-result" | "specification-context";
  text: string;
}

export type SpecificationContextUnavailableReason =
  | "no-request-identity"
  | "no-generated-collection"
  | "not-generated-by-current-workflow"
  | "no-originating-scenario";

/** An upstream operation whose output this request consumes. Names only, never values. */
export interface UpstreamContext {
  via: "integration-workflow" | "dependency-relationship";
  stepPosition?: number;
  operationPath: string;
  operationMethod: string;
  suppliedFields: string[];
  outcomeInRun: "passed" | "failed" | "not-attempted" | "not-in-run";
}

/** Captured once at analysis time and stored with the analysis (FR-018). */
export type SpecificationContext =
  | {
      status: "matched";
      workflowId: string;
      scenarioId: string;
      scenarioName: string;
      scenarioCategory: string;
      operationPath: string;
      operationMethod: string;
      documentedStatusCodes: string[];
      requestEditedAfterGeneration: boolean;
      upstream: UpstreamContext[];
    }
  | { status: "unavailable"; reason: SpecificationContextUnavailableReason };

export interface FailureAnalysisProvenance {
  source: "AI";
  aiModel: string;
  aiProvider: AIProviderMode;
  responseVersion: number;
  /** The threshold applied, so an older analysis stays interpretable if the constant changes. */
  confidenceThreshold: number;
  generatedAt: string;
}

/** The AI-generated explanation for one failed uploaded-collection result (FR-003, FR-010). */
export interface FailureAnalysis {
  runId: string;
  resultIndex: number;
  requestName: string;
  requestMethod: string;
  conclusion: FailureAnalysisConclusion;
  /** Model text; always presented as an inference (FR-007). */
  summary: string;
  /** At least one entry when `conclusion.kind === "likely-cause"`. */
  investigationSteps: string[];
  /** Every entry is an `evidence[].id`. */
  citedEvidenceIds: string[];
  evidence: FailureEvidence[];
  specificationContext: SpecificationContext;
  provenance: FailureAnalysisProvenance;
}

/** The session's single analysis in progress (FR-016). In memory only. */
export interface FailureAnalysisInProgress {
  runId: string;
  resultIndex: number;
  requestName: string;
  phase: "waiting-for-ai" | "generating";
  phaseStartedAt: string;
}

/** The POST response body (contracts/failure-analysis-api.md). */
export type FailureAnalysisAttempt =
  | { status: "analyzed"; analysis: FailureAnalysis }
  | {
      status: "ai-failed";
      aiErrorCategory: AIErrorCategory;
      message: string;
      previousAnalysis?: FailureAnalysis;
    }
  | {
      status: "not-viable";
      notViable: { projectedMs: number; budgetMs: number };
      message: string;
      previousAnalysis?: FailureAnalysis;
    };
