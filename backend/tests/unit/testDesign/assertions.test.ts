import { describe, expect, it } from "vitest";
import type { ApiOperation } from "@apipilot/shared-domain";
import { selectNegativeAssertions, selectPositiveAssertions } from "../../../src/testDesign/assertions";
import { constraintsApiModel } from "../../fixtures/testDesign/constraintsApiModel";
import { nestedRequiredApiModel } from "../../fixtures/testDesign/nestedRequiredApiModel";

const updateWidget = nestedRequiredApiModel.operations[0];
const createItem = constraintsApiModel.operations[0];

function documentedStatusCodes(operation: ApiOperation): string[] {
  return operation.responses.map((response) => response.statusCode);
}

describe("selectPositiveAssertions", () => {
  it("selects the lowest documented 2xx status code and a schema-conformance assertion when a schema is documented", () => {
    const result = selectPositiveAssertions(updateWidget);
    expect(result.assertions).toEqual([
      { type: "status-code", expectedStatusCode: "200" },
      { type: "schema-conformance", expectedSchema: expect.objectContaining({ type: "object" }) },
    ]);
    expect(documentedStatusCodes(updateWidget)).toContain(result.assertions[0].expectedStatusCode);
  });

  it("falls back to the lowest documented status overall when no 2xx is documented", () => {
    const result = selectPositiveAssertions(createItem);
    expect(result.assertions).toEqual([{ type: "status-code", expectedStatusCode: "400" }]);
  });

  it("returns an empty assertion list with a gap description when no response is documented at all", () => {
    const operationWithNoResponses: ApiOperation = { ...createItem, responses: [] };
    const result = selectPositiveAssertions(operationWithNoResponses);
    expect(result.assertions).toEqual([]);
    expect(result.gapDescription).toBeDefined();
  });
});

describe("selectNegativeAssertions", () => {
  it("selects the lowest documented 4xx status code", () => {
    const result = selectNegativeAssertions(createItem);
    expect(result.assertions).toEqual([{ type: "status-code", expectedStatusCode: "400" }]);
    expect(documentedStatusCodes(createItem)).toContain(result.assertions[0].expectedStatusCode);
  });

  it("returns an empty assertion list with a gap description when no documented error response exists", () => {
    const operationWithNoErrorResponse: ApiOperation = {
      ...updateWidget,
      responses: [updateWidget.responses[0]],
    };
    const result = selectNegativeAssertions(operationWithNoErrorResponse);
    expect(result.assertions).toEqual([]);
    expect(result.gapDescription).toBeDefined();
  });
});

describe("SC-006: every expected status code is documented", () => {
  it("never asserts an undocumented status code", () => {
    for (const operation of [updateWidget, createItem]) {
      const documented = new Set(documentedStatusCodes(operation));
      for (const result of [selectPositiveAssertions(operation), selectNegativeAssertions(operation)]) {
        for (const assertion of result.assertions) {
          if (assertion.type === "status-code") {
            expect(documented.has(assertion.expectedStatusCode as string)).toBe(true);
          }
        }
      }
    }
  });
});
