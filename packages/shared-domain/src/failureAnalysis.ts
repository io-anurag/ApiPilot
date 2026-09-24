import type { AIErrorCategory, AIProviderMode } from "./aiProvider";

/**
 * AI Failure Analysis domain contracts (AP-031, specs/030-ai-failure-analysis data-model.md).
 *
 * Framework-agnostic per constitution VIII/X. An analysis explains one failed
 * `UploadedRequestResult`, addressed by `(runId, resultIndex)`. Evidence is extracted
 * deterministically (research D4). Since 2026-09-24 the cause is decided by deterministic rules
 * (research D15) and the AI writes only the explanation (research D16, D17).
 */

export type FailureCause =
  | "specification-mismatch"
  | "environment-issue"
  | "downstream-service-issue";

/** The classification rules, in the order they are checked (research D15). */
export type FailureRuleId =
  | "no-response"
  | "gateway-error"
  | "environment-rejected-request"
  | "dependency-named-in-server-error"
  | "undocumented-status"
  | "status-assertion-mismatch"
  | "response-content-assertion";

/** One plain sentence per rule, shared by the prompt and the UI (data-model.md). */
export const FAILURE_RULE_DESCRIPTIONS: Readonly<Record<FailureRuleId, string>> = {
  "no-response": "No response was received: the connection failed or timed out.",
  "gateway-error": "A gateway in front of the API returned 502 or 504, so the API itself was not reached.",
  "environment-rejected-request":
    "The environment rejected the request (401, 403, 407, 408 or 429): credentials, access, a proxy, a timeout or a rate limit.",
  "dependency-named-in-server-error":
    "The API returned 500 or 503 and its response names another service it depends on.",
  "undocumented-status": "The response status is not one the specification documents for this operation.",
  "status-assertion-mismatch": "A test expected a different response status than the one received.",
  "response-content-assertion":
    "The response status was successful, but a test on the response's content failed with a reason.",
};

/** A rule's fixed, documented strength; shown as a label with no number (clarification 2026-09-24). */
export type FailureStrength = "high" | "moderate";

/** Decided by rules, never by the AI (FR-003, FR-008). */
export type FailureAnalysisConclusion =
  | {
      kind: "likely-cause";
      cause: FailureCause;
      strength: FailureStrength;
      ruleId: FailureRuleId;
      /** Ids of the evidence that triggered the rule; always at least one. */
      decidingEvidenceIds: string[];
    }
  | { kind: "insufficient-evidence"; reason: "no-rule-matched" };

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
  | "upstream-step-outcome";

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

/** Provenance of the cause (FR-010): the rule itself is `conclusion.ruleId`. */
export interface ClassificationProvenance {
  source: "RULE";
  ruleSetVersion: number;
}

/** Provenance of an available AI explanation (FR-010). */
export interface ExplanationProvenance {
  source: "AI";
  aiModel: string;
  aiProvider: AIProviderMode;
  responseVersion: number;
}

export type ExplanationUnavailableReason =
  | { kind: "ai-error"; aiErrorCategory: AIErrorCategory }
  | { kind: "not-viable"; projectedMs: number; budgetMs: number };

/** The AI-written part of an analysis, or why it is missing (FR-006, research D17). */
export type FailureAnalysisExplanation =
  | {
      status: "available";
      /** Model text; always presented as an inference (FR-007). */
      summary: string;
      /** One to three entries. */
      investigationSteps: string[];
      /** At least one entry; every entry is an `evidence[].id`. */
      citedEvidenceIds: string[];
      provenance: ExplanationProvenance;
    }
  | { status: "unavailable"; reason: ExplanationUnavailableReason; message: string };

/** One failed uploaded-collection result explained: a rule-decided cause plus an AI explanation. */
export interface FailureAnalysis {
  /** Marks the rule-decided design; rows without it are removed on startup (research D19). */
  analysisVersion: 2;
  runId: string;
  resultIndex: number;
  requestName: string;
  requestMethod: string;
  conclusion: FailureAnalysisConclusion;
  classificationProvenance: ClassificationProvenance;
  explanation: FailureAnalysisExplanation;
  /** The full, untrimmed evidence list the rules read (research D15). */
  evidence: FailureEvidence[];
  specificationContext: SpecificationContext;
  analyzedAt: string;
}

/** The session's single analysis in progress (FR-016). In memory only. */
export interface FailureAnalysisInProgress {
  runId: string;
  resultIndex: number;
  requestName: string;
  phase: "waiting-for-ai" | "generating";
  phaseStartedAt: string;
}

/** The POST response body (contracts/failure-analysis-api.md, research D18). */
export type FailureAnalysisAttempt =
  /** Stored, replacing any earlier analysis; its explanation may be unavailable. */
  | { status: "analyzed"; analysis: FailureAnalysis }
  /**
   * The new explanation is unavailable and the stored analysis has an available one, so the stored
   * analysis was kept unchanged (FR-015). `analysis` is the new, unstored attempt.
   */
  | { status: "kept-previous"; analysis: FailureAnalysis; previousAnalysis: FailureAnalysis; message: string };
