import type { ApiOperation, ExpectedStatus, PerformanceStep } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";

/**
 * Expected status codes per step (FR-012, FR-012a, FR-039; specs/031-k6-performance-testing
 * research D26). The pre-fill is every success status the specification documents; any other
 * code is explicit user configuration. `source` is always computed here, never accepted from a
 * client, so it cannot be misreported.
 */

const DOCUMENTED_SUCCESS = /^(2\d\d|2XX)$/;
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

/** Whether a response status matches one of a step's expected codes (exact, or `NXX` range). */
export function statusMatches(status: number, expected: readonly ExpectedStatus[] | PerformanceStep["expectedStatuses"]): boolean {
  const text = String(status);
  return expected.some((entry) =>
    RANGE_CODE.test(entry.code) ? text.length === 3 && text[0] === entry.code[0] : text === entry.code,
  );
}
