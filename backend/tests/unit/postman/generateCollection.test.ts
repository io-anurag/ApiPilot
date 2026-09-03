import { describe, expect, it } from "vitest";
import type { TestModel } from "@apipilot/shared-domain";
import { generateCollection } from "../../../src/postman/generateCollection";
import {
  approvedTestModel,
  exportApiModel,
  minimalApiModel,
  minimalTestModel,
} from "../../fixtures/postman/exportFixtures";

function items(outcome: ReturnType<typeof generateCollection>) {
  if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
  return outcome.result.collection.item.flatMap((folder) => folder.item);
}

describe("generateCollection", () => {
  it("emits exactly one request per approved scenario", () => {
    const outcome = generateCollection(exportApiModel, approvedTestModel);
    expect(items(outcome)).toHaveLength(approvedTestModel.scenarios.length);
  });

  it("emits no request for a scenario the approved model does not contain", () => {
    const outcome = generateCollection(minimalApiModel, minimalTestModel);
    const names = items(outcome).map((item) => item.name);
    expect(names).toEqual(["GET /ping — positive"]);
  });

  it("reports the request count, folder count, and counts by origin", () => {
    const outcome = generateCollection(exportApiModel, approvedTestModel);
    if (!outcome.ok) throw new Error("expected a successful export");
    expect(outcome.result.summary.requestCount).toBe(approvedTestModel.scenarios.length);
    expect(outcome.result.summary.folderCount).toBe(outcome.result.collection.item.length);
    expect(outcome.result.summary.byProvenance).toEqual({ RULE: 7, AI: 1 });
  });

  it("refuses an empty approved TestModel rather than returning an empty collection", () => {
    const outcome = generateCollection(exportApiModel, { scenarios: [] });
    expect(outcome).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "empty_approved_test_model" }),
    });
  });

  it("refuses a scenario referencing an operation the ApiModel does not contain", () => {
    const model: TestModel = {
      scenarios: [
        { ...minimalTestModel.scenarios[0], operationPath: "/absent", operationMethod: "GET" },
      ],
    };
    const outcome = generateCollection(minimalApiModel, model);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe("unknown_operation");
    expect(outcome.failure.message).toContain("/absent");
  });

  it("refuses a TestModel carrying multi-step workflow intent instead of flattening it", () => {
    const model = {
      scenarios: [
        {
          ...minimalTestModel.scenarios[0],
          steps: [{ operationPath: "/ping", extract: { id: "$.id" } }],
        },
      ],
    } as unknown as TestModel;
    const outcome = generateCollection(minimalApiModel, model);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe("workflow_intent_unsupported");
  });

  it("records limitations without blocking the export", () => {
    const outcome = generateCollection(exportApiModel, approvedTestModel);
    if (!outcome.ok) throw new Error("expected a successful export");
    const kinds = outcome.result.limitations.map((limitation) => limitation.kind);
    expect(kinds).toContain("no-expected-outcome");
    expect(kinds).toContain("undocumented-status-code");
    expect(kinds).toContain("unsupported-content-type");
    expect(kinds).toContain("unresolved-path-parameter");
    expect(outcome.result.validation.valid).toBe(true);
  });

  it("names the collection deterministically when the engineer supplies no name", () => {
    const first = generateCollection(minimalApiModel, minimalTestModel);
    const second = generateCollection(minimalApiModel, minimalTestModel);
    if (!first.ok || !second.ok) throw new Error("expected successful exports");
    expect(first.result.collection.info.name).toBe(second.result.collection.info.name);
    expect(first.result.collection.info.schema).toContain("v2.1.0");
  });

  it("uses a supplied collection name without letting it affect request content", () => {
    const named = generateCollection(minimalApiModel, minimalTestModel, {
      collectionName: "Ping suite",
    });
    const unnamed = generateCollection(minimalApiModel, minimalTestModel);
    if (!named.ok || !unnamed.ok) throw new Error("expected successful exports");
    expect(named.result.collection.info.name).toBe("Ping suite");
    expect(named.result.collection.item).toEqual(unnamed.result.collection.item);
  });
});