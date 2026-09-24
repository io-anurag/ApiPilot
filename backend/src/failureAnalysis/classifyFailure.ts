import type {
  FailureAnalysisConclusion,
  FailureCause,
  FailureEvidence,
  FailureEvidenceKind,
  FailureRuleId,
  FailureStrength,
  SpecificationContext,
  UploadedRequestResult,
  UploadedTestOutcome,
} from "@apipilot/shared-domain";

/**
 * Deterministic classification of a failed result's likely cause (specs/030-ai-failure-analysis
 * research D15; constitution II, XV). Rules are checked in a fixed order and the first match
 * decides; ambiguous signals deliberately match nothing. The AI never sets or changes the result.
 *
 * `evidence` must be the full, untrimmed list (research D15, `/speckit-analyze` C1), so the cause
 * never depends on the model's input budget. Every scan here is linear, because response bodies
 * and test messages are controlled by the target API.
 */

export const FAILURE_CLASSIFICATION_RULESET_VERSION = 1;

const ENVIRONMENT_REJECTION_STATUSES = new Set([401, 403, 407, 408, 429]);
const GATEWAY_STATUSES = new Set([502, 504]);
const DEPENDENCY_ERROR_STATUSES = new Set([500, 503]);
const SERVICE_SUFFIXES = ["-service", "_service", "-svc", "_svc"];
/** The standard Postman `pm.response.to.have.status` failure message. */
const STATUS_ASSERTION = /expected response to have status code (\d{3}) but got (\d{3})/;

interface RuleMatch {
  ruleId: FailureRuleId;
  cause: FailureCause;
  strength: FailureStrength;
  /** Evidence kinds that triggered the rule; `failedTests` adds those tests' own outcome items. */
  kinds: FailureEvidenceKind[];
  failedTests?: readonly UploadedTestOutcome[];
}

function isTokenChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 || // -
    code === 95 // _
  );
}

function tokenNamesService(token: string): boolean {
  const lower = token.toLowerCase();
  return SERVICE_SUFFIXES.some((suffix) => lower.length > suffix.length && lower.endsWith(suffix));
}

/**
 * Whether the text names a service identifier such as `payment-service` or `inventory_svc`
 * (research D15 rule 4). One linear pass, splitting on anything other than letters, digits, `-`
 * and `_`. Words like `upstream` are deliberately not signals.
 */
export function namesAnotherService(text: string): boolean {
  let start = -1;
  for (let index = 0; index <= text.length; index += 1) {
    const inToken = index < text.length && isTokenChar(text.charCodeAt(index));
    if (inToken && start < 0) start = index;
    if (!inToken && start >= 0) {
      if (tokenNamesService(text.slice(start, index))) return true;
      start = -1;
    }
  }
  return false;
}

function statusAssertion(test: UploadedTestOutcome): { expected: number; got: number } | undefined {
  if (!test.detail) return undefined;
  const match = STATUS_ASSERTION.exec(test.detail);
  return match ? { expected: Number(match[1]), got: Number(match[2]) } : undefined;
}

/** Whether `status` is covered by a documented code, including `2XX`-style ranges. */
function isDocumented(status: number, documented: readonly string[]): boolean {
  const text = String(status);
  return documented.some((code) => {
    const normalized = code.trim().toUpperCase();
    if (normalized === text) return true;
    return /^[1-5]XX$/.test(normalized) && normalized[0] === text[0];
  });
}

function responseBody(evidence: readonly FailureEvidence[]): string | undefined {
  return evidence.find((item) => item.kind === "response-body-excerpt")?.text;
}

function matchRule(
  result: UploadedRequestResult,
  context: SpecificationContext,
  evidence: readonly FailureEvidence[],
): RuleMatch | undefined {
  if (result.failureCategory === "connectivity-failure" || result.failureCategory === "timeout") {
    return { ruleId: "no-response", cause: "environment-issue", strength: "high", kinds: ["failure-category"] };
  }

  const status = result.responseStatusCode;
  if (status === undefined) return undefined;
  const failedTests = result.testOutcomes.filter((test) => test.outcome === "failed");

  if (GATEWAY_STATUSES.has(status)) {
    return { ruleId: "gateway-error", cause: "environment-issue", strength: "moderate", kinds: ["response-status"] };
  }
  if (ENVIRONMENT_REJECTION_STATUSES.has(status)) {
    return {
      ruleId: "environment-rejected-request",
      cause: "environment-issue",
      strength: "moderate",
      kinds: ["response-status"],
    };
  }
  if (DEPENDENCY_ERROR_STATUSES.has(status)) {
    const body = responseBody(evidence);
    if (body !== undefined && namesAnotherService(body)) {
      return {
        ruleId: "dependency-named-in-server-error",
        cause: "downstream-service-issue",
        strength: "moderate",
        kinds: ["response-status", "response-body-excerpt"],
      };
    }
    return undefined;
  }
  // Below: 1xx to 4xx. A 404 is ambiguous (wrong base URL, or a route that differs from the
  // specification) and a 5xx without a named dependency says too little; both match nothing.
  if (status >= 500 || status === 404) return undefined;

  if (
    context.status === "matched" &&
    context.documentedStatusCodes.length > 0 &&
    !context.documentedStatusCodes.some((code) => code.trim().toLowerCase() === "default") &&
    !isDocumented(status, context.documentedStatusCodes)
  ) {
    return {
      ruleId: "undocumented-status",
      cause: "specification-mismatch",
      strength: "high",
      kinds: ["response-status", "documented-responses"],
    };
  }

  const statusMismatches = failedTests.filter((test) => {
    const assertion = statusAssertion(test);
    return assertion !== undefined && assertion.expected !== assertion.got;
  });
  if (statusMismatches.length > 0) {
    return {
      ruleId: "status-assertion-mismatch",
      cause: "specification-mismatch",
      strength: "moderate",
      kinds: ["response-status"],
      failedTests: statusMismatches,
    };
  }

  if (
    status >= 200 &&
    status < 300 &&
    failedTests.length > 0 &&
    failedTests.every((test) => (test.detail ?? "").trim().length > 0 && statusAssertion(test) === undefined)
  ) {
    return {
      ruleId: "response-content-assertion",
      cause: "specification-mismatch",
      strength: "moderate",
      kinds: ["response-status"],
      failedTests,
    };
  }
  return undefined;
}

function decidingEvidenceIds(match: RuleMatch, evidence: readonly FailureEvidence[]): string[] {
  const ids = match.kinds.flatMap((kind) => evidence.filter((item) => item.kind === kind).map((item) => item.id));
  for (const test of match.failedTests ?? []) {
    const prefix = `Test "${test.name}" failed`;
    const item = evidence.find((candidate) => candidate.kind === "test-outcome" && candidate.text.startsWith(prefix));
    if (item && !ids.includes(item.id)) ids.push(item.id);
  }
  return ids;
}

export function classifyFailure(
  result: UploadedRequestResult,
  context: SpecificationContext,
  evidence: readonly FailureEvidence[],
): FailureAnalysisConclusion {
  const match = matchRule(result, context, evidence);
  if (!match) return { kind: "insufficient-evidence", reason: "no-rule-matched" };
  return {
    kind: "likely-cause",
    cause: match.cause,
    strength: match.strength,
    ruleId: match.ruleId,
    decidingEvidenceIds: decidingEvidenceIds(match, evidence),
  };
}
