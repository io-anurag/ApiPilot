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

/**
 * AP-037 (specs/037-request-chain-performance research R22): request-chain scripts, in memory like
 * the others, keyed by plan id within the session. A backend restart drops them; the plan shows
 * "Script not generated" and the same plan regenerates the same bytes.
 */
const chainScripts = new Map<string, Map<string, GeneratedScript>>();

onExpire((sessionId) => {
  chainScripts.delete(sessionId);
});

export function getChainScript(planId: string): GeneratedScript | undefined {
  return chainScripts.get(getSessionId())?.get(planId);
}

export function saveChainScript(planId: string, script: GeneratedScript): void {
  const sessionId = getSessionId();
  const scriptsOfSession = chainScripts.get(sessionId) ?? new Map<string, GeneratedScript>();
  scriptsOfSession.set(planId, script);
  chainScripts.set(sessionId, scriptsOfSession);
}

export function deleteChainScript(planId: string): void {
  chainScripts.get(getSessionId())?.delete(planId);
}
