import type {
  ExportOptions,
  ReviewEditContent,
  ReviewUpdateOutcome,
  ReviewUpdateRequest,
  TestGenerationWorkflow,
} from "@apipilot/shared-domain";

/** One client for every endpoint in contracts/test-generation-workflow-api.md. */

export type WorkflowResult =
  | { ok: true; workflow: TestGenerationWorkflow }
  | { ok: false; error: string; message: string; problems?: string[] };

export type WorkflowOrNoneResult =
  | { ok: true; workflow: TestGenerationWorkflow | null }
  | { ok: false; error: string; message: string };

async function toWorkflowResult(response: Response): Promise<WorkflowResult> {
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: (parsed?.error as string) ?? "unknown_error",
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

async function postJson(path: string, body?: unknown): Promise<WorkflowResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return await toWorkflowResult(response);
  } catch (err) {
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

/** Fetches the current workflow, or `workflow: null` when none is in progress (FR-014). */
export async function fetchCurrentWorkflow(): Promise<WorkflowOrNoneResult> {
  try {
    const response = await get("/api/test-generation-workflow");
    if (response.status === 204) return { ok: true, workflow: null };
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        error: (parsed?.error as string) ?? "unknown_error",
        message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
      };
    }
    return { ok: true, workflow: parsed.workflow as TestGenerationWorkflow };
  } catch (err) {
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
    return await toWorkflowResult(response);
  } catch (err) {
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Upload failed" };
  }
}

export function continueApiReview(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/api-review/continue");
}

export function runDeterministicGeneration(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/deterministic-generation");
}

export function runAiEnhancement(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/ai-enhancement");
}

/**
 * Requests cancellation of the AI enhancement run in progress
 * (specs/013-ai-enhancement-viability). Resolves as soon as the request is accepted (202) rather
 * than when the run settles, so the user regains control promptly; the terminal outcome arrives
 * through the existing status poll.
 */
export function cancelAiEnhancement(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/ai-enhancement/cancel");
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
  if (!response) return { ok: false, error: "network_error", message: "Request failed" };
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: (parsed?.error as string) ?? "unknown_error",
      message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
    };
  }
  return { ok: true, workflow: parsed.workflow, outcomes: parsed.outcomes as ReviewUpdateOutcome[] };
}

export type ScenarioActionResult =
  | { ok: true; workflow: TestGenerationWorkflow; outcome: ReviewUpdateOutcome }
  | { ok: false; error: string; message: string };

async function postScenarioAction(path: string, body: unknown): Promise<ScenarioActionResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: "network_error", message: "Request failed" };
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: (parsed?.error as string) ?? "unknown_error",
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
  return postScenarioAction("/api/test-generation-workflow/scenario-review/edit", { scenarioId, revision, edit });
}

export function regenerateScenario(scenarioId: string, revision: number): Promise<ScenarioActionResult> {
  return postScenarioAction("/api/test-generation-workflow/scenario-review/regenerate", { scenarioId, revision });
}

export function finalizeScenarioReview(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/scenario-review/finalize");
}

export function recordWorkflowDecisions(
  decisions: { workflowId: string; state: "approved" | "rejected"; reason?: string }[],
): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/workflow-review/decisions", { decisions });
}

export function continueWorkflowReview(): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/workflow-review/continue");
}

export function generatePostmanCollection(options?: ExportOptions): Promise<WorkflowResult> {
  return postJson("/api/test-generation-workflow/postman-generation", { options });
}
