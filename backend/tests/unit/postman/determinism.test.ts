import { describe, expect, it } from "vitest";
import type { ExportResult, WorkflowExportContext } from "@apipilot/shared-domain";
import { generateCollection } from "../../../src/postman/generateCollection";
import { serializeArtifact } from "../../../src/postman/ordering";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";
import {
  chainingApiModel,
  graphOf,
  ordersDeleteRelationship,
  ordersDeleteScenario,
  ordersGetRelationship,
  ordersGetScenario,
  ordersListScenario,
  ordersPatchRelationship,
  ordersPatchScenario,
  testModelOf,
} from "../../fixtures/postman/dependencyFixtures";

const options = { baseUrl: "https://qa.internal.example", variableValues: { token: "t-1" } };

function exportResult(testModel = approvedTestModel): ExportResult {
  const outcome = generateCollection(exportApiModel, testModel, options);
  if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
  return outcome.result;
}

function serialized(result: ExportResult): string {
  return [
    serializeArtifact(result.collection),
    serializeArtifact(result.environment),
    result.readme,
  ].join("\n");
}

describe("export determinism", () => {
  it("produces byte-identical artifacts from identical input", () => {
    expect(serialized(exportResult())).toBe(serialized(exportResult()));
  });

  it("produces the same artifacts regardless of the input scenario order", () => {
    const shuffled = { scenarios: [...approvedTestModel.scenarios].reverse() };
    expect(serialized(exportResult(shuffled))).toBe(serialized(exportResult()));
  });

  it("keeps every item id stable across repeated exports", () => {
    const first = exportResult().collection.item.flatMap((folder) => folder.item.map((i) => i.id));
    const second = exportResult().collection.item.flatMap((folder) => folder.item.map((i) => i.id));
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("emits no identifier that varies with time or randomness", () => {
    const first = exportResult().collection.info._postman_id;
    const second = exportResult().collection.info._postman_id;
    expect(second).toBe(first);
  });
});

describe("automatic chaining determinism (specs/019-auto-workflow-chaining SC-004)", () => {
  const chainingOptions = { baseUrl: "https://qa.internal.example" };
  const testModel = testModelOf(ordersListScenario, ordersGetScenario, ordersPatchScenario, ordersDeleteScenario);
  const context: WorkflowExportContext = {
    workflows: [],
    approvedWorkflowIds: [],
    automaticChaining: {
      graph: graphOf(ordersGetRelationship(), ordersPatchRelationship(), ordersDeleteRelationship()),
      cycles: [],
      workflowDecisions: {},
    },
  };

  function chainedExportResult(): ExportResult {
    const outcome = generateCollection(chainingApiModel, testModel, chainingOptions, context);
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    return outcome.result;
  }

  it("produces byte-identical automatic-chaining decisions and artifacts across repeated exports", () => {
    expect(serialized(chainedExportResult())).toBe(serialized(chainedExportResult()));
  });

  it("produces the same chaining decisions regardless of the input scenario order", () => {
    const shuffled = testModelOf(ordersDeleteScenario, ordersPatchScenario, ordersGetScenario, ordersListScenario);
    const outcome = generateCollection(chainingApiModel, shuffled, chainingOptions, context);
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    expect(serialized(outcome.result)).toBe(serialized(chainedExportResult()));
  });
});