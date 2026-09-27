import type { ApiOperation } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { InvalidExpectedStatusError } from "../../../src/performance/errors";
import {
  normalizeExpectedStatuses,
  prefillExpectedStatuses,
  statusMatches,
  stepsNeedingExpectedStatus,
} from "../../../src/performance/plan/expectedStatuses";
import { journeyFixture, stepFixture } from "../../fixtures/performance/builders";

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

  it("deduplicates, sorts and marks each code's source against the pre-fill", () => {
    expect(normalizeExpectedStatuses("s1", ["201", "200", "201", "4XX"], ["201"])).toEqual([
      { code: "200", source: "user" },
      { code: "201", source: "specification" },
      { code: "4XX", source: "user" },
    ]);
  });

  it("rejects an empty list and malformed codes", () => {
    for (const codes of [[], ["600"], ["2xx"], ["20"], [201], "200"]) {
      expect(() => normalizeExpectedStatuses("s1", codes, [])).toThrow(InvalidExpectedStatusError);
    }
  });

  it("lists steps with no expected status, in plan order", () => {
    const journeys = [
      journeyFixture({ id: "j1", steps: [stepFixture({ id: "a", expectedStatuses: [] }), stepFixture({ id: "b" })] }),
      journeyFixture({ id: "j2", steps: [stepFixture({ id: "c", expectedStatuses: [] })] }),
    ];
    expect(stepsNeedingExpectedStatus(journeys)).toEqual(["a", "c"]);
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
