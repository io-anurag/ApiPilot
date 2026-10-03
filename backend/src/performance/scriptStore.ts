import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";

/**
 * A generated k6 script and environment template, backend-only (specs/031-k6-performance-testing
 * data-model.md "Generated script"). No response carries the script text; the frontend sees only
 * `ScriptStatus` and the download route.
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
