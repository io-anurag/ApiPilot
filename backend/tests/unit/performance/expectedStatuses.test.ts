import type { ApiOperation } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { prefillExpectedStatuses, statusMatches } from "../../../src/performance/plan/expectedStatuses";

/** FR-012, FR-012a (research D26, tasks T027). */

function operation(codes: string[]): ApiOperation {
  return {
    path: "/x",
    method: "get",
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: codes.map((statusCode) => ({ statusCode, description: "", contentTypes: {}, examples: {} })),
    security: [],
    tags: [],
  };
}

describe("expected statuses", () => {
  it("pre-fills every documented 2xx code and the 2XX range, sorted, never default or non-2xx", () => {
    expect(prefillExpectedStatuses(operation(["404", "201", "default", "2XX", "200", "500"]))).toEqual(["200", "201", "2XX"]);
  });

  it("pre-fills nothing when no success status is documented (GET /status in the fixture)", () => {
    expect(prefillExpectedStatuses(operation(["503", "default"]))).toEqual([]);
  });

  it("matches exact codes and NXX ranges", () => {
    const expected = [
      { code: "201", source: "specification" as const },
      { code: "4XX", source: "user" as const },
    ];
    expect(statusMatches(201, expected)).toBe(true);
    expect(statusMatches(404, expected)).toBe(true);
    expect(statusMatches(200, expected)).toBe(false);
    expect(statusMatches(0, expected)).toBe(false);
    expect(statusMatches(204, [{ code: "2XX", source: "user" }])).toBe(true);
  });
});
