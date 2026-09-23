import { describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { UnknownOperationKeyError } from "../../../src/testGenerationWorkflow/errors";
import {
  normalizeOperationSelection,
  scopeApiModelToSelection,
} from "../../../src/testGenerationWorkflow/operationSelection";

function operation(method: string, path: string): ApiOperation {
  return {
    method,
    path,
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: [],
    security: [],
    tags: [],
  };
}

const apiModel: ApiModel = {
  operations: [operation("get", "/pets"), operation("post", "/pets"), operation("get", "/pets/{id}")],
  securitySchemes: {},
  summary: { operationCount: 3, schemaCount: 2, securitySchemeCount: 0, issues: [] },
};

describe("normalizeOperationSelection", () => {
  it("treats an absent or empty selection as every operation (undefined)", () => {
    expect(normalizeOperationSelection(apiModel, undefined)).toBeUndefined();
    expect(normalizeOperationSelection(apiModel, [])).toBeUndefined();
  });

  it("deduplicates and returns keys in apiModel order regardless of request order", () => {
    expect(
      normalizeOperationSelection(apiModel, ["GET /pets/{id}", "GET /pets", "GET /pets/{id}"]),
    ).toEqual(["GET /pets", "GET /pets/{id}"]);
  });

  it("refuses a key the specification does not contain rather than dropping it", () => {
    expect(() => normalizeOperationSelection(apiModel, ["GET /pets", "DELETE /pets"])).toThrow(
      UnknownOperationKeyError,
    );
  });
});

describe("scopeApiModelToSelection", () => {
  const base = { apiModel } as TestGenerationWorkflow;

  it("returns the full apiModel when no subset was chosen", () => {
    expect(scopeApiModelToSelection(base)).toBe(apiModel);
  });

  it("narrows only operations, leaving the analyzed summary and security schemes intact", () => {
    const scoped = scopeApiModelToSelection({ ...base, selectedOperationKeys: ["POST /pets"] });
    expect(scoped.operations).toEqual([apiModel.operations[1]]);
    expect(scoped.summary).toBe(apiModel.summary);
    expect(scoped.securitySchemes).toBe(apiModel.securitySchemes);
  });

  it("does not mutate the workflow's apiModel", () => {
    scopeApiModelToSelection({ ...base, selectedOperationKeys: ["GET /pets"] });
    expect(apiModel.operations).toHaveLength(3);
  });
});
