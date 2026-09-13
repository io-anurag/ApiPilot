import { describe, expect, it } from "vitest";
import type { ExportResult, IntegrationWorkflow, TestModel, WorkflowExportContext } from "@apipilot/shared-domain";
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
  workflowDecision,
} from "../../fixtures/postman/dependencyFixtures";

const options = { baseUrl: "https://qa.internal.example" };
const REMOVED_SCENARIO = "scenario-list-no-assertions";

function exportOf(testModel: TestModel): ExportResult {
  const outcome = generateCollection(exportApiModel, testModel, options);
  if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
  return outcome.result;
}

function itemsById(result: ExportResult) {
  return new Map(
    result.collection.item.flatMap((folder) =>
      folder.item.map((item) => [item.id, { folder: folder.name, item }] as const),
    ),
  );
}

const withoutOne: TestModel = {
  scenarios: approvedTestModel.scenarios.filter((scenario) => scenario.id !== REMOVED_SCENARIO),
};

describe("re-export stability", () => {
  it("produces identical artifacts when no review decision changed", () => {
    const first = exportOf(approvedTestModel);
    const second = exportOf(approvedTestModel);
    expect(serializeArtifact(second.collection)).toBe(serializeArtifact(first.collection));
    expect(serializeArtifact(second.environment)).toBe(serializeArtifact(first.environment));
    expect(second.readme).toBe(first.readme);
  });

  it("removes only the rejected scenario's request", () => {
    const before = itemsById(exportOf(approvedTestModel));
    const after = itemsById(exportOf(withoutOne));

    expect(after.size).toBe(before.size - 1);
    for (const [id, entry] of before) {
      const remaining = after.get(id);
      if (remaining === undefined) continue;
      expect(remaining).toEqual(entry);
    }
  });

  it("leaves every surviving item id unchanged", () => {
    const before = [...itemsById(exportOf(approvedTestModel)).keys()];
    const after = [...itemsById(exportOf(withoutOne)).keys()];
    expect(after.every((id) => before.includes(id))).toBe(true);
    expect(before.filter((id) => !after.includes(id))).toHaveLength(1);
  });

  it("leaves the folder order and folder membership unchanged", () => {
    const before = exportOf(approvedTestModel).collection.item.map((folder) => folder.name);
    const after = exportOf(withoutOne).collection.item.map((folder) => folder.name);
    expect(after).toEqual(before);
  });

  it("keeps the declared variable set stable for the scenarios that remain", () => {
    const before = exportOf(approvedTestModel).environment.values.map((value) => value.key);
    const after = exportOf(withoutOne).environment.values.map((value) => value.key);
    expect(after).toEqual(before);
  });

  it("does not renumber items when a scenario earlier in the order is removed", () => {
    const withoutFirst: TestModel = {
      scenarios: approvedTestModel.scenarios.filter(
        (scenario) => scenario.id !== "scenario-admin-revoke",
      ),
    };
    const before = itemsById(exportOf(approvedTestModel));
    const after = itemsById(exportOf(withoutFirst));
    for (const [id, entry] of after) {
      expect(before.get(id)?.item.id).toBe(entry.item.id);
    }
  });
});

describe("re-export stability for automatic chains (specs/019-auto-workflow-chaining)", () => {
  const chainingOptions = { baseUrl: "https://qa.internal.example" };
  const chainingTestModel = testModelOf(
    ordersListScenario,
    ordersGetScenario,
    ordersPatchScenario,
    ordersDeleteScenario,
  );
  const candidateWorkflows: IntegrationWorkflow[] = [
    { id: "wf-get", steps: [], variables: [], relationshipIds: ["rel-orders-get"] },
    { id: "wf-patch", steps: [], variables: [], relationshipIds: ["rel-orders-patch"] },
    { id: "wf-delete", steps: [], variables: [], relationshipIds: ["rel-orders-delete"] },
  ];
  const graph = graphOf(ordersGetRelationship(), ordersPatchRelationship(), ordersDeleteRelationship());

  function contextWith(rejectedWorkflowId?: string): WorkflowExportContext {
    return {
      workflows: candidateWorkflows,
      approvedWorkflowIds: [],
      automaticChaining: {
        graph,
        cycles: [],
        workflowDecisions: rejectedWorkflowId
          ? { [rejectedWorkflowId]: workflowDecision(rejectedWorkflowId, "rejected") }
          : {},
      },
    };
  }

  it("removes only the rejected relationship's chain, leaving the others and their ordering stable", () => {
    const before = generateCollection(chainingApiModel, chainingTestModel, chainingOptions, contextWith());
    const after = generateCollection(chainingApiModel, chainingTestModel, chainingOptions, contextWith("wf-delete"));
    if (!before.ok || !after.ok) throw new Error("expected successful exports");

    expect(before.result.summary.automaticChainCount).toBe(3);
    expect(after.result.summary.automaticChainCount).toBe(2);
    expect(after.result.limitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unresolved-path-parameter", scenarioId: ordersDeleteScenario.id }),
      ]),
    );

    const beforeItems = itemsById(before.result);
    const afterItems = itemsById(after.result);
    for (const [id, entry] of afterItems) {
      if (id === beforeItems.get(id)?.item.id && entry.item.provenance?.scenarioId === ordersDeleteScenario.id) {
        continue; // this one item's request is expected to differ — it lost its chained substitution
      }
      expect(afterItems.get(id)).toEqual(beforeItems.get(id));
    }
    expect(after.result.collection.item.map((folder) => folder.name)).toEqual(
      before.result.collection.item.map((folder) => folder.name),
    );
  });
});
