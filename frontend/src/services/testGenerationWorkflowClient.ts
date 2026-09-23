import type {
  AiEnhancementProgressSnapshot,
  ExportOptions,
  ReviewEditContent,
  ReviewUpdateOutcome,
  ReviewUpdateRequest,
  TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/** One client for every endpoint in contracts/test-generation-workflow-api.md. */

const logger = createLogger("testGenerationWorkflowClient");

export type WorkflowResult =
  | { ok: true; workflow: TestGenerationWorkflow }
  | { ok: false; error: string; message: string; problems?: string[] };

export type WorkflowOrNoneResult =
  | { ok: true; workflow: TestGenerationWorkflow | null; sessionExpired?: boolean }
  | { ok: false; error: string; message: string };

async function toWorkflowResult(response: Response, operation: string): Promise<WorkflowResult> {
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    const errorCategory = (parsed?.error as string) ?? "unknown_error";
    logger.error("request_failed", { operation, errorCategory, statusCode: response.status });
    return {
      ok: false,
      error: errorCategory,
      message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
      ...(Array.isArray(parsed?.problems) ? { problems: parsed.problems as string[] } : {}),
    };
  }
  return { ok: true, workflow: parsed.workflow as TestGenerationWorkflow };
}

async function get(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (err) {
    throw err instanceof Error ? err : new Error("Request failed");
  }
}

async function postJson(path: string, operation: string, body?: unknown): Promise<WorkflowResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return await toWorkflowResult(response, operation);
  } catch (err) {
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

/**
 * Fetches the current workflow, or `workflow: null` when none is in progress (FR-014). When the
 * calling session's own prior workflow was discarded for inactivity, `sessionExpired: true` is
 * also set, distinguishing that case from a session that never started one
 * (specs/017-session-workflow-isolation FR-007a, contracts/session-isolation.md).
 */
export async function fetchCurrentWorkflow(): Promise<WorkflowOrNoneResult> {
  try {
    const response = await get("/api/test-generation-workflow");
    if (response.status === 204) return { ok: true, workflow: null };
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      const errorCategory = (parsed?.error as string) ?? "unknown_error";
      logger.error("request_failed", {
        operation: "fetchCurrentWorkflow",
        errorCategory,
        statusCode: response.status,
      });
      return {
        ok: false,
        error: errorCategory,
        message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
      };
    }
    return {
      ok: true,
      workflow: parsed.workflow as TestGenerationWorkflow | null,
      ...(parsed?.sessionExpired ? { sessionExpired: true as const } : {}),
    };
  } catch (err) {
    logger.error("network_error", { operation: "fetchCurrentWorkflow", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

export type AiEnhancementProgressResult =
  | { ok: true; snapshot: AiEnhancementProgressSnapshot | null; sessionExpired?: boolean }
  | { ok: false; error: string; message: string };

/**
 * Polls the lightweight `progressOnly` variant of the workflow endpoint
 * (contracts/ai-enhancement-progress-v2.md addendum) instead of `fetchCurrentWorkflow()`'s full
 * payload — this is what `AiEnhancementStage` calls every 2s while a run is active, so it must
 * not resend `apiModel`/`approvedTestModel`/the full `reviewWorkspace` on every tick.
 */
export async function fetchAiEnhancementProgress(): Promise<AiEnhancementProgressResult> {
  try {
    const response = await get("/api/test-generation-workflow?progressOnly=true");
    if (response.status === 204) return { ok: true, snapshot: null };
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      const errorCategory = (parsed?.error as string) ?? "unknown_error";
      logger.error("request_failed", {
        operation: "fetchAiEnhancementProgress",
        errorCategory,
        statusCode: response.status,
      });
      return {
        ok: false,
        error: errorCategory,
        message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
      };
    }
    if (parsed?.sessionExpired) return { ok: true, snapshot: null, sessionExpired: true };
    return { ok: true, snapshot: (parsed?.progress as AiEnhancementProgressSnapshot | undefined) ?? null };
  } catch (err) {
    logger.error("network_error", { operation: "fetchAiEnhancementProgress", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

/** Starts a new workflow from an uploaded specification (FR-001, FR-010). */
export async function startWorkflow(file: File, discardExisting = false): Promise<WorkflowResult> {
  const formData = new FormData();
  formData.append("file", file);
  try {
    const response = await fetch(
      `/api/test-generation-workflow${discardExisting ? "?discardExisting=true" : ""}`,
      { method: "POST", body: formData },
    );
    return await toWorkflowResult(response, "startWorkflow");
  } catch (err) {
    logger.error("network_error", { operation: "startWorkflow", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Upload failed" };
  }
}

/**
 * Completes API review. `selectedOperationKeys` (`toOperationKey()` keys) narrows deterministic
 * generation and AI enhancement to those operations; omitted or empty keeps every operation in
 * scope (specs/009 Clarifications 2026-09-23), so no key list is sent in that case.
 */
export function continueApiReview(selectedOperationKeys: readonly string[] = []): Promise<WorkflowResult> {
  return postJson(
    "/api/test-generation-workflow/api-review/continue",
    "continueApiReview",
    selectedOperationKeys.length > 0 ? { selectedOperationKeys } : undefined,
  );
}

export function runDeterministicGeneration(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/deterministic-generation", "runDeterministicGeneration");
}

export function runAiEnhancement(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/ai-enhancement", "runAiEnhancement");
}

/**
 * Requests cancellation of the AI enhancement run in progress
 * (specs/013-ai-enhancement-viability). Resolves as soon as the request is accepted (202) rather
 * than when the run settles, so the user regains control promptly; the terminal outcome arrives
 * through the existing status poll.
 */
export function cancelAiEnhancement(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/ai-enhancement/cancel", "cancelAiEnhancement");
}

/**
 * Retries exactly one batch from the most recent AI Enhancement run
 * (specs/015-ai-batch-retry, contracts/ai-enhancement-retry-batch.md). Resolves once the retry
 * has settled (succeeded or failed again) — this endpoint does not poll or stream.
 */
export function retryAiEnhancementBatch(batchIndex: number): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/ai-enhancement/retry-batch", "retryAiEnhancementBatch", {
    batchIndex,
  });
}

export type ScenarioDecisionOutcomeResult =
  | { ok: true; workflow: TestGenerationWorkflow; outcomes: ReviewUpdateOutcome[] }
  | { ok: false; error: string; message: string };

export async function applyScenarioDecisions(updates: ReviewUpdateRequest[]): Promise<ScenarioDecisionOutcomeResult> {
  const response = await fetch("/api/test-generation-workflow/scenario-review/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  }).catch(() => null);
  if (!response) {
    logger.error("network_error", { operation: "applyScenarioDecisions", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: "Request failed" };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    const errorCategory = (parsed?.error as string) ?? "unknown_error";
    logger.error("request_failed", {
      operation: "applyScenarioDecisions",
      errorCategory,
      statusCode: response.status,
    });
    return {
      ok: false,
      error: errorCategory,
      message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
    };
  }
  return { ok: true, workflow: parsed.workflow, outcomes: parsed.outcomes as ReviewUpdateOutcome[] };
}

export type ScenarioActionResult =
  | { ok: true; workflow: TestGenerationWorkflow; outcome: ReviewUpdateOutcome }
  | { ok: false; error: string; message: string };

async function postScenarioAction(path: string, operation: string, body: unknown): Promise<ScenarioActionResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) {
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: "Request failed" };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    const errorCategory = (parsed?.error as string) ?? "unknown_error";
    logger.error("request_failed", { operation, errorCategory, statusCode: response.status });
    return {
      ok: false,
      error: errorCategory,
      message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
    };
  }
  return { ok: true, workflow: parsed.workflow, outcome: parsed.outcome as ReviewUpdateOutcome };
}

export function editScenario(
  scenarioId: string,
  revision: number,
  edit: ReviewEditContent,
): Promise<ScenarioActionResult> {
  return postScenarioAction("/api/test-generation-workflow/scenario-review/edit", "editScenario", {
    scenarioId,
    revision,
    edit,
  });
}

export function regenerateScenario(scenarioId: string, revision: number): Promise<ScenarioActionResult> {
  return postScenarioAction("/api/test-generation-workflow/scenario-review/regenerate", "regenerateScenario", {
    scenarioId,
    revision,
  });
}

export function finalizeScenarioReview(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/scenario-review/finalize", "finalizeScenarioReview");
}

export function recordWorkflowDecisions(
  decisions: { workflowId: string; state: "approved" | "rejected"; reason?: string }[],
): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/workflow-review/decisions", "recordWorkflowDecisions", {
    decisions,
  });
}

export function continueWorkflowReview(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/workflow-review/continue", "continueWorkflowReview");
}

export function generatePostmanCollection(options?: ExportOptions): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/postman-generation", "generatePostmanCollection", { options });
}
