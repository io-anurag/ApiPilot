import { describe, expect, it } from "vitest";
import type { TestModel, WorkflowExportContext } from "@apipilot/shared-domain";
import { generateCollection } from "../../../src/postman/generateCollection";
import {
  approvedTestModel,
  exportApiModel,
  minimalApiModel,
  minimalTestModel,
} from "../../fixtures/postman/exportFixtures";
import {
  chainingApiModel,
  graphOf,
  legacyOrdersDeleteRelationship,
  legacyOrdersListScenario,
  ordersDeleteRelationship,
  ordersDeleteScenario,
  ordersGetRelationship,
  ordersGetScenario,
  ordersListScenario,
  ordersPatchRelationship,
  ordersPatchScenario,
  testModelOf,
} from "../../fixtures/postman/dependencyFixtures";
import { integrationWorkflow, workflowStep, workflowVariable } from "../../fixtures/postman/workflowFixtures";

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

  describe("automatic workflow chaining (specs/019-auto-workflow-chaining)", () => {
    const testModel = testModelOf(ordersListScenario, ordersDeleteScenario);
    const automaticContext: WorkflowExportContext = {
      workflows: [],
      approvedWorkflowIds: [],
      automaticChaining: { graph: graphOf(ordersDeleteRelationship()), cycles: [], workflowDecisions: {} },
    };

    it("resolves an eligible unresolved path parameter without a manually approved workflow (US1)", () => {
      const outcome = generateCollection(chainingApiModel, testModel, {}, automaticContext);
      if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
      expect(outcome.result.limitations.some((limitation) => limitation.kind === "unresolved-path-parameter")).toBe(
        false,
      );
      expect(outcome.result.summary.automaticChainCount).toBe(1);
    });

    it("reverts to pre-019 behavior byte-for-byte when disableAutomaticChaining is set (US2, FR-011)", () => {
      const disabled = generateCollection(
        chainingApiModel,
        testModel,
        { disableAutomaticChaining: true },
        automaticContext,
      );
      const withoutContext = generateCollection(chainingApiModel, testModel);
      if (!disabled.ok || !withoutContext.ok) throw new Error("expected successful exports");
      expect(JSON.stringify(disabled.result)).toBe(JSON.stringify(withoutContext.result));
      expect(
        disabled.result.limitations.filter((limitation) => limitation.kind === "unresolved-path-parameter"),
      ).toHaveLength(1);
      expect(disabled.result.summary.automaticChainCount).toBe(0);
    });

    it("does nothing when no automaticChaining context is supplied at all", () => {
      const outcome = generateCollection(chainingApiModel, testModel);
      if (!outcome.ok) throw new Error("expected a successful export");
      expect(outcome.result.summary.automaticChainCount).toBe(0);
      expect(outcome.result.limitations.some((limitation) => limitation.kind === "unresolved-path-parameter")).toBe(
        true,
      );
    });

    it("coexists with an approved workflow without duplicating or conflicting with it (FR-008)", () => {
      const variable = workflowVariable("id", 0, "id", 1, "path", "id", "rel-workflow-get");
      const workflow = integrationWorkflow(
        "wf-get",
        [
          workflowStep(0, "GET", "/orders", { producesVariableNames: ["id"] }),
          workflowStep(1, "GET", "/orders/{id}", { consumesVariableNames: ["id"] }),
        ],
        [variable],
      );
      const combinedTestModel = testModelOf(
        ordersListScenario,
        ordersGetScenario,
        legacyOrdersListScenario,
        ordersDeleteScenario,
      );
      const context: WorkflowExportContext = {
        workflows: [workflow],
        approvedWorkflowIds: ["wf-get"],
        automaticChaining: {
          graph: graphOf(legacyOrdersDeleteRelationship()),
          cycles: [],
          workflowDecisions: {},
        },
      };

      const outcome = generateCollection(chainingApiModel, combinedTestModel, {}, context);
      if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);

      // The approved workflow renders as its own sequence...
      expect(outcome.result.summary.workflowCount).toBe(1);
      expect(
        outcome.result.collection.item.some((folder) => folder.name === "Workflow: wf-get"),
      ).toBe(true);
      // ...and an entirely independent producer/consumer pair is still auto-chained.
      expect(outcome.result.summary.automaticChainCount).toBe(1);

      // No approved scenario is ever rendered twice (once as a workflow step, once standalone).
      const allScenarioIds = outcome.result.collection.item
        .flatMap((folder) => folder.item)
        .map((item) => item.provenance?.scenarioId);
      expect(new Set(allScenarioIds).size).toBe(allScenarioIds.length);
      expect(allScenarioIds.sort()).toEqual(
        [
          ordersListScenario.id,
          ordersGetScenario.id,
          legacyOrdersListScenario.id,
          ordersDeleteScenario.id,
        ].sort(),
      );

      // The workflow's own producer is not additionally treated as an automatic-chain producer.
      expect(outcome.result.summary.standaloneRequestCount).toBe(2);
      expect(outcome.result.summary.workflowRequestCount).toBe(2);
    });

    it("resolves the representative create/read/update/delete relationship shape at ≥90% (SC-001)", () => {
      // GET /orders (producer) feeding GET/PATCH/DELETE /orders/{id} (three previously-unresolved
      // consumers) is exactly the "clear create/read/update/delete relationship" shape SC-001
      // describes. All three resolve here (100% ≥ 90%), demonstrating the target on the feature's
      // own representative case rather than requiring a separate synthetic benchmark corpus.
      const crudTestModel = testModelOf(ordersListScenario, ordersGetScenario, ordersPatchScenario, ordersDeleteScenario);
      const beforeOutcome = generateCollection(chainingApiModel, crudTestModel);
      if (!beforeOutcome.ok) throw new Error("expected a successful export");
      const previouslyUnresolvedCount = beforeOutcome.result.limitations.filter(
        (limitation) => limitation.kind === "unresolved-path-parameter",
      ).length;
      expect(previouslyUnresolvedCount).toBe(3);

      const afterOutcome = generateCollection(chainingApiModel, crudTestModel, {}, {
        workflows: [],
        approvedWorkflowIds: [],
        automaticChaining: {
          graph: graphOf(ordersGetRelationship(), ordersPatchRelationship(), ordersDeleteRelationship()),
          cycles: [],
          workflowDecisions: {},
        },
      });
      if (!afterOutcome.ok) throw new Error("expected a successful export");
      const resolutionRate = afterOutcome.result.summary.automaticChainCount / previouslyUnresolvedCount;
      expect(resolutionRate).toBeGreaterThanOrEqual(0.9);
      expect(afterOutcome.result.summary.automaticChainCount).toBe(3);
    });
  });
});