import type { ApiOperation, Assertion, Response as ApiResponse } from "@apipilot/shared-domain";

/**
 * Deterministic response-assertion selection (research.md decision 6). Every assertion
 * traces to a status code/schema already documented in the ApiModel (FR-010, FR-011,
 * SC-006); when no applicable documented response exists, an empty assertion list is
 * returned with a gap description rather than fabricating one (constitution XIV, XIX).
 */

export interface AssertionResult {
  assertions: Assertion[];
  gapDescription?: string;
}

function statusCodeSortKey(code: string): number {
  const numeric = Number(code);
  return Number.isNaN(numeric) ? Number.POSITIVE_INFINITY : numeric;
}

function lowestByPrefix(operation: ApiOperation, prefix: string): ApiResponse | undefined {
  const candidates = operation.responses.filter((response) => response.statusCode.startsWith(prefix));
  return candidates.length > 0
    ? candidates.reduce((lowest, response) =>
        statusCodeSortKey(response.statusCode) < statusCodeSortKey(lowest.statusCode) ? response : lowest,
      )
    : undefined;
}

function lowestOverall(operation: ApiOperation): ApiResponse | undefined {
  return operation.responses.length > 0
    ? operation.responses.reduce((lowest, response) =>
        statusCodeSortKey(response.statusCode) < statusCodeSortKey(lowest.statusCode) ? response : lowest,
      )
    : undefined;
}

function schemaConformanceAssertion(response: ApiResponse): Assertion | undefined {
  const schema = response.contentTypes["application/json"] ?? Object.values(response.contentTypes)[0];
  return schema ? { type: "schema-conformance", expectedSchema: schema } : undefined;
}

/** Positive scenarios assert the lowest documented 2xx, or the lowest documented status if none is 2xx (FR-010, FR-011). */
export function selectPositiveAssertions(operation: ApiOperation): AssertionResult {
  const response = lowestByPrefix(operation, "2") ?? lowestOverall(operation);
  if (!response) {
    return {
      assertions: [],
      gapDescription: "No documented response was available to assert a positive outcome against.",
    };
  }
  const assertions: Assertion[] = [{ type: "status-code", expectedStatusCode: response.statusCode }];
  const schemaAssertion = schemaConformanceAssertion(response);
  if (schemaAssertion) assertions.push(schemaAssertion);
  return { assertions };
}

/** Negative scenarios assert the lowest documented 4xx; an empty gap when none is documented (FR-010). */
export function selectNegativeAssertions(operation: ApiOperation): AssertionResult {
  const response = lowestByPrefix(operation, "4");
  if (!response) {
    return {
      assertions: [],
      gapDescription: "No documented error response was available to assert against; the expected outcome is not fabricated.",
    };
  }
  return { assertions: [{ type: "status-code", expectedStatusCode: response.statusCode }] };
}
