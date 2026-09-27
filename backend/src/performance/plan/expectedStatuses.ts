import type { ApiOperation, ExpectedStatus, PerformancePlan, PerformanceStep } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { InvalidExpectedStatusError } from "../errors";

/**
 * Expected status codes per step (FR-012, FR-012a, FR-039; specs/031-k6-performance-testing
 * research D26). The pre-fill is every success status the specification documents; any other
 * code is explicit user configuration. `source` is always computed here, never accepted from a
 * client, so it cannot be misreported.
 */

const DOCUMENTED_SUCCESS = /^(2\d\d|2XX)$/;
const EXACT_CODE = /^[1-5]\d\d$/;
const RANGE_CODE = /^[1-5]XX$/;

/** Every documented exact 2xx code and the `2XX` range, in code-unit order. Never `default`. */
export function prefillExpectedStatuses(operation: ApiOperation): string[] {
  const codes = operation.responses.map((response) => response.statusCode).filter((code) => DOCUMENTED_SUCCESS.test(code));
  return [...new Set(codes)].sort(compareCodeUnits);
}

export function withSources(codes: readonly string[], prefill: readonly string[]): ExpectedStatus[] {
  const documented = new Set(prefill);
  return codes.map((code) => ({ code, source: documented.has(code) ? "specification" : "user" }));
}

export function isValidStatusCode(code: string): boolean {
  return EXACT_CODE.test(code) || RANGE_CODE.test(code);
}

/**
 * Validates and normalizes a user's list for one step: non-empty, each an exact code or a range,
 * duplicates removed, code-unit sorted, sources recomputed against the pre-fill.
 */
export function normalizeExpectedStatuses(stepId: string, codes: unknown, prefill: readonly string[]): ExpectedStatus[] {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new InvalidExpectedStatusError(stepId, "A step needs at least one expected status code.");
  }
  for (const code of codes) {
    if (typeof code !== "string" || !isValidStatusCode(code)) {
      throw new InvalidExpectedStatusError(
        stepId,
        "Expected status codes must be exact codes such as 201 or ranges such as 2XX.",
      );
    }
  }
  const unique = [...new Set(codes as string[])].sort(compareCodeUnits);
  return withSources(unique, prefill);
}

/** Step ids with no expected status, in plan order (FR-012a). */
export function stepsNeedingExpectedStatus(journeys: PerformancePlan["journeys"]): string[] {
  return journeys.flatMap((journey) => journey.steps).filter((step) => step.expectedStatuses.length === 0).map((step) => step.id);
}

/** Whether a response status matches one of a step's expected codes (exact, or `NXX` range). */
export function statusMatches(status: number, expected: readonly ExpectedStatus[] | PerformanceStep["expectedStatuses"]): boolean {
  const text = String(status);
  return expected.some((entry) =>
    RANGE_CODE.test(entry.code) ? text.length === 3 && text[0] === entry.code[0] : text === entry.code,
  );
}
