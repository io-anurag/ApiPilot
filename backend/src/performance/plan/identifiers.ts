import { createHash } from "node:crypto";

/**
 * Content-derived ids for AP-029 plans (specs/031-k6-performance-testing research D5), in the
 * style of `postman/identifiers.ts`: a pure function of content, never random or time-based, so
 * the same approvals always give the same ids and the script stays byte-identical (SC-001).
 * Ids are short and URL-safe because a step id is also the `step` metrics tag.
 */
function shortDigest(namespace: string, content: string): string {
  return createHash("sha256").update(`${namespace} ${content}`).digest("hex").slice(0, 16);
}

export function journeyIdFor(source: { workflowId: string } | { operationKey: string }): string {
  const content = "workflowId" in source ? `workflow:${source.workflowId}` : `op:${source.operationKey}`;
  return `j_${shortDigest("apipilot/performance/journey", content)}`;
}

export function stepIdFor(journeyId: string, operationKey: string): string {
  return `s_${shortDigest("apipilot/performance/step", `${journeyId} ${operationKey}`)}`;
}

/**
 * AP-035 research R2: a user-defined journey's id, from a per-plan sequence number the server
 * assigns on creation and keeps in the plan, so it never changes on rename or reorder.
 */
export function userJourneyIdFor(sequence: number): string {
  return `j_${shortDigest("apipilot/performance/journey", `user:${sequence}`)}`;
}

/**
 * AP-035 research R2: a user journey step's id, from a per-journey sequence number assigned when
 * the step is added, so the same operation can appear more than once and each occurrence keeps its
 * own settings.
 */
export function userJourneyStepIdFor(journeyId: string, sequence: number): string {
  return `s_${shortDigest("apipilot/performance/step", `${journeyId}:${sequence}`)}`;
}

export function thresholdIdFor(content: string): string {
  return `t_${shortDigest("apipilot/performance/threshold", content)}`;
}

/** SHA-256 hex of text, used for plan fingerprints and script hashes. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON with object keys sorted in code-unit order at every depth, for stable fingerprints. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
