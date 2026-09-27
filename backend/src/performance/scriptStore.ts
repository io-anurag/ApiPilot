import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { getCurrentWorkflow } from "../testGenerationWorkflow/workflowStore";

/**
 * The generated k6 script and environment template, backend-only (specs/031-k6-performance-testing
 * data-model.md "Generated script"). Never placed on the workflow record, so no workflow response
 * can carry the script text; the frontend sees only `ScriptStatus` and the download route.
 */
export interface GeneratedScript {
  planFingerprint: string;
  scriptSha256: string;
  environmentTemplateSha256: string;
  script: string;
  environmentTemplate: string;
  stepCount: number;
  /** Value name → the index of its `APIPILOT_V_<index>` environment variable (research D7). */
  valueIndex: Record<string, number>;
}

const scripts = new Map<string, { workflowId: string; script: GeneratedScript }>();

onExpire((sessionId) => {
  scripts.delete(sessionId);
});

/** The calling session's script, only while it belongs to the session's current workflow. */
export function getGeneratedScript(): GeneratedScript | undefined {
  const entry = scripts.get(getSessionId());
  const workflowId = getCurrentWorkflow()?.id;
  if (!entry || entry.workflowId !== workflowId) return undefined;
  return entry.script;
}

export function setGeneratedScript(script: GeneratedScript): void {
  const workflowId = getCurrentWorkflow()?.id;
  if (!workflowId) throw new Error("No workflow is currently in progress.");
  scripts.set(getSessionId(), { workflowId, script });
}

export function clearGeneratedScript(): void {
  scripts.delete(getSessionId());
}
