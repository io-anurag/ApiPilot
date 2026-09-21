import type { UploadedFailureCategory, UploadedRequestResult, UploadedTestOutcome } from "@apipilot/shared-domain";
import type { NewmanExecutionResult } from "../execution/mapNewmanResult";
import { buildRawCapture, isTimeoutError, redactIfSensitive } from "../execution/mapNewmanResult";

/**
 * Maps one Newman single-item run result for an *uploaded* collection's request to
 * `UploadedRequestResult` (research.md D6) — deliberately **not** `mapNewmanResult()`: that
 * function interprets Newman's assertions against a `TestScenario`'s typed
 * `"status-code"`/`"schema-conformance"` vocabulary, which an uploaded collection's arbitrary,
 * author-named `pm.test(...)` scripts never declare. `testOutcomes` here is read directly off
 * Newman's own `execution.assertions[]`, naming each test exactly as the collection's own script
 * named it — never guessed into a classification the collection didn't declare (constitution
 * I/XIV).
 *
 * @param captureRawDetails FR-017a parity: the caller passes `true` only for a `"local"`-tier run.
 * @param wasEdited AP-028 (research.md D6): `true` only when the executed item carried the
 * `_apipilotEdited` marker (`editedItems.ts`) — surfaced onto the result so a user can tell an
 * edited request's outcome apart from the collection's original definition (FR-011).
 */
export function mapUploadedResult(
  requestName: string,
  requestMethod: string,
  execution: NewmanExecutionResult,
  startedAt: string,
  captureRawDetails = false,
  wasEdited = false,
): UploadedRequestResult {
  const base = { requestName, requestMethod, startedAt, ...(wasEdited ? { wasEdited: true } : {}) };
  const rawCapture = captureRawDetails ? buildRawCapture(execution) : undefined;

  if (execution.requestError) {
    const failureCategory: UploadedFailureCategory = isTimeoutError(execution.requestError)
      ? "timeout"
      : "connectivity-failure";
    return { ...base, outcome: "failed", failureCategory, durationMs: 0, testOutcomes: [], rawCapture };
  }

  const durationMs = execution.response?.responseTime ?? 0;
  const responseStatusCode = execution.response?.code;

  const testOutcomes: UploadedTestOutcome[] = (execution.assertions ?? [])
    .filter((assertion) => !assertion.skipped)
    .map((assertion) => {
      if (!assertion.error) {
        return { name: assertion.assertion, outcome: "passed" as const };
      }
      return {
        name: assertion.assertion,
        outcome: "failed" as const,
        detail: redactIfSensitive(assertion.error.message),
      };
    });

  const failing = testOutcomes.filter((outcome) => outcome.outcome === "failed");
  if (failing.length === 0) {
    return { ...base, outcome: "passed", durationMs, responseStatusCode, testOutcomes, rawCapture };
  }
  return {
    ...base,
    outcome: "failed",
    failureCategory: "assertion-failed",
    durationMs,
    responseStatusCode,
    testOutcomes,
    rawCapture,
  };
}
