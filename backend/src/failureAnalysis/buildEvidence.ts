import type {
  FailureEvidence,
  FailureEvidenceKind,
  RawHeader,
  SpecificationContext,
  UpstreamContext,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import { redactBody, redactFreeText, redactHeaders, redactUrl } from "./redaction";

/**
 * Deterministic, redacted evidence for one failed result (specs/030-ai-failure-analysis research
 * D4). The model may only cite these ids; it never writes evidence text. Same input, same output:
 * no clock, no randomness, fixed kind order and fixed English templates.
 */

export const REQUEST_BODY_EXCERPT_LIMIT = 600;
export const RESPONSE_BODY_EXCERPT_LIMIT = 1_000;
/** Beyond this many passed tests, the rest are summarized by count so one request cannot crowd out the prompt. */
const MAX_PASSED_TEST_OUTCOMES = 5;

export interface EvidenceOptions {
  /** Drop body excerpts to fit the model's input capacity (research D8). */
  omitBodies?: boolean;
  /** Also drop header lists. */
  omitHeaders?: boolean;
}

export interface EvidenceBuild {
  evidence: FailureEvidence[];
  /** Every original value redaction replaced, for scanning model output afterwards. */
  sensitiveValues: string[];
}

interface Draft {
  kind: FailureEvidenceKind;
  source: FailureEvidence["source"];
  text: string;
}

const FAILURE_CATEGORY_TEXT: Record<NonNullable<UploadedRequestResult["failureCategory"]>, string> = {
  "connectivity-failure": "Request failed: connectivity failure, no response was received",
  timeout: "Request failed: timed out, no response was received",
  "assertion-failed": "Request failed: one or more of the collection's tests failed",
};

const OUTCOME_IN_RUN_TEXT: Record<UpstreamContext["outcomeInRun"], string> = {
  passed: "passed in this run",
  failed: "failed in this run",
  "not-attempted": "was not sent in this run",
  "not-in-run": "is not part of this run",
};

function headerText(label: string, headers: readonly RawHeader[]): string {
  if (headers.length === 0) return `${label}: none`;
  return `${label}: ${headers.map((header) => `${header.key}: ${header.value}`).join("; ")}`;
}

function excerptText(label: string, excerpt: { text: string; truncated: boolean }): string {
  return `${label}: ${excerpt.text}${excerpt.truncated ? " [truncated]" : ""}`;
}

function upstreamText(entry: UpstreamContext): string {
  const where =
    entry.via === "integration-workflow"
      ? `Upstream workflow step ${entry.stepPosition ?? "?"}`
      : "Upstream producer";
  return `${where} ${entry.operationMethod.toUpperCase()} ${entry.operationPath} (supplies ${entry.suppliedFields.join(", ")}): ${OUTCOME_IN_RUN_TEXT[entry.outcomeInRun]}`;
}

export function buildEvidence(
  result: UploadedRequestResult,
  context: SpecificationContext,
  options: EvidenceOptions = {},
): EvidenceBuild {
  const drafts: Draft[] = [];
  const sensitiveValues: string[] = [];
  const omitted: string[] = [];
  const add = (kind: FailureEvidenceKind, text: string, source: Draft["source"] = "run-result") =>
    drafts.push({ kind, source, text });

  if (result.failureCategory) add("failure-category", FAILURE_CATEGORY_TEXT[result.failureCategory]);
  if (result.responseStatusCode !== undefined) add("response-status", `Response status ${result.responseStatusCode}`);
  if (result.durationMs > 0) add("response-time", `Response time ${result.durationMs} ms`);

  const failedTests = result.testOutcomes.filter((test) => test.outcome === "failed");
  const passedTests = result.testOutcomes.filter((test) => test.outcome === "passed");
  for (const test of failedTests) {
    const detail = test.detail ? redactFreeText(test.detail) : undefined;
    if (detail) sensitiveValues.push(...detail.redacted);
    add("test-outcome", `Test "${test.name}" failed${detail ? `: ${detail.value}` : ""}`);
  }
  for (const test of passedTests.slice(0, MAX_PASSED_TEST_OUTCOMES)) {
    add("test-outcome", `Test "${test.name}" passed`);
  }
  if (passedTests.length > MAX_PASSED_TEST_OUTCOMES) {
    add("test-outcome", `${passedTests.length - MAX_PASSED_TEST_OUTCOMES} more tests passed`);
  }

  const capture = result.rawCapture;
  if (capture) {
    const url = redactUrl(capture.requestUrl);
    sensitiveValues.push(...url.redacted);
    add("request-line", `${result.requestMethod.toUpperCase()} ${url.value}`);

    const requestHeaders = redactHeaders(capture.requestHeaders);
    const responseHeaders = redactHeaders(capture.responseHeaders);
    sensitiveValues.push(...requestHeaders.redacted, ...responseHeaders.redacted);
    const requestBody = capture.requestBody ? redactBody(capture.requestBody, REQUEST_BODY_EXCERPT_LIMIT) : undefined;
    const responseBody = capture.responseBody
      ? redactBody(capture.responseBody, RESPONSE_BODY_EXCERPT_LIMIT)
      : undefined;
    sensitiveValues.push(...(requestBody?.redacted ?? []), ...(responseBody?.redacted ?? []));

    if (options.omitHeaders) omitted.push("header lists");
    else add("request-headers", headerText("Request headers", requestHeaders.value));

    if (options.omitBodies) {
      if (requestBody || responseBody) omitted.push("body excerpts");
    } else if (requestBody && requestBody.text.length > 0) {
      add("request-body-excerpt", excerptText("Request body", requestBody));
    }

    if (!options.omitHeaders) add("response-headers", headerText("Response headers", responseHeaders.value));
    if (!options.omitBodies && responseBody && responseBody.text.length > 0) {
      add("response-body-excerpt", excerptText("Response body", responseBody));
    }
  }

  if (result.wasEdited) {
    add("request-edited", "This request was edited in the collection editor before it was run");
  }

  if (context.status === "matched") {
    const method = context.operationMethod.toUpperCase();
    add(
      "documented-responses",
      context.documentedStatusCodes.length > 0
        ? `Operation ${method} ${context.operationPath} documents responses: ${context.documentedStatusCodes.join(", ")}`
        : `Operation ${method} ${context.operationPath} documents no responses`,
      "specification-context",
    );
    add(
      "scenario-expectation",
      `Generated from scenario "${context.scenarioName}" (category: ${context.scenarioCategory})`,
      "specification-context",
    );
    for (const entry of context.upstream) add("upstream-step-outcome", upstreamText(entry), "specification-context");
  }

  if (omitted.length > 0) {
    add("omitted-for-capacity", `Some evidence (${omitted.join(" and ")}) was omitted to fit the model's input capacity`);
  }

  return {
    evidence: drafts.map((draft, index) => ({ id: `E${index + 1}`, ...draft })),
    sensitiveValues,
  };
}
