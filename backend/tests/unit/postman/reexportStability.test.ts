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
import {
  adminAuthOperation,
  adminReportsScenario,
  bearerAuthOperation,
  discoverableProducerApiModel,
  issueAdminTokenScenario,
  issueTokenScenario,
  tokenInfoScenario,
  twoIndependentSchemesApiModel,
} from "../../fixtures/postman/credentialFixtures";
import { filterDeepObjectOperation, parameterApiModel, sortDefaultOperation } from "../../fixtures/postman/parameterFixtures";

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

describe("re-export stability for distinct-credential schemes (specs/021-multi-credential-token-provisioning)", () => {
  const bearerScenario = {
    id: "scenario-bearer",
    category: "positive" as const,
    operationPath: bearerAuthOperation.path,
    operationMethod: bearerAuthOperation.method,
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [{ type: "status-code" as const, expectedStatusCode: "200" }],
    provenance: { source: "RULE" as const, rule: "positive", description: "GET /orders.", duplicateOfRules: [] },
  };
  const adminScenario = {
    id: "scenario-admin",
    category: "positive" as const,
    operationPath: adminAuthOperation.path,
    operationMethod: adminAuthOperation.method,
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [{ type: "status-code" as const, expectedStatusCode: "200" }],
    provenance: { source: "RULE" as const, rule: "positive", description: "GET /reports.", duplicateOfRules: [] },
  };

  function exportOfCredential(testModel: TestModel): ExportResult {
    const outcome = generateCollection(discoverableProducerApiModel, testModel);
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    return outcome.result;
  }

  it("leaves the primary scheme's request and {{token}} routing unchanged when the distinct scheme's scenario is removed", () => {
    const before = exportOfCredential({ scenarios: [bearerScenario, adminScenario] });
    const after = exportOfCredential({ scenarios: [bearerScenario] });

    const beforeItems = itemsById(before);
    const afterItems = itemsById(after);
    const bearerItemId = [...beforeItems.entries()].find(
      ([, entry]) => entry.item.provenance?.scenarioId === bearerScenario.id,
    )?.[0];
    expect(bearerItemId).toBeDefined();

    // Method/URL/name/provenance are unaffected either way. `auth` itself may move between the
    // item and the collection level (an unrelated, pre-existing optimization in
    // generateCollection.ts that hoists auth shared by every item to `collection.auth`), so the
    // effective auth — wherever it lives — is compared separately below rather than as part of a
    // whole-item equality check.
    const { request: beforeRequest, ...beforeRest } = beforeItems.get(bearerItemId!)!.item;
    const { request: afterRequest, ...afterRest } = afterItems.get(bearerItemId!)!.item;
    const { auth: beforeAuth, ...beforeRequestRest } = beforeRequest;
    const { auth: afterAuth, ...afterRequestRest } = afterRequest;
    expect(afterRequestRest).toEqual(beforeRequestRest);
    expect(afterRest).toEqual(beforeRest);

    const expectedAuth = { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] };
    expect(beforeAuth ?? before.collection.auth).toEqual(expectedAuth);
    expect(afterAuth ?? after.collection.auth).toEqual(expectedAuth);
  });

  it("drops the distinct scheme's variable once no exported operation references it, while credentialProducers (a specification-level fact) stays the same", () => {
    const withBoth = exportOfCredential({ scenarios: [bearerScenario, adminScenario] });
    const withoutAdmin = exportOfCredential({ scenarios: [bearerScenario] });

    expect(withBoth.environment.values.map((value) => value.key)).toContain("adminToken");
    expect(withoutAdmin.environment.values.map((value) => value.key)).not.toContain("adminToken");
    // credentialProducers reflects the specification's own structure (research.md D5), not which
    // scenarios happen to be approved — it is unaffected by removing the admin scenario.
    expect(withoutAdmin.credentialProducers).toEqual(withBoth.credentialProducers);
  });
});

describe("re-export stability for auth-credential chains (specs/023-auto-auth-credential-chaining)", () => {
  const authContext: WorkflowExportContext = {
    workflows: [],
    approvedWorkflowIds: [],
    automaticChaining: { graph: graphOf(), cycles: [], workflowDecisions: {} },
  };

  function exportOfAuth(testModel: TestModel): ExportResult {
    const outcome = generateCollection(twoIndependentSchemesApiModel, testModel, {}, authContext);
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    return outcome.result;
  }

  it("leaves the primary scheme's chain and {{token}} routing unchanged when the second scheme's scenarios are removed", () => {
    const before = exportOfAuth(
      testModelOf(issueTokenScenario, tokenInfoScenario, issueAdminTokenScenario, adminReportsScenario),
    );
    const after = exportOfAuth(testModelOf(issueTokenScenario, tokenInfoScenario));

    expect(before.summary.automaticChainCount).toBe(2);
    expect(after.summary.automaticChainCount).toBe(1);

    const beforeItems = itemsById(before);
    const afterItems = itemsById(after);
    const tokenInfoEntry = [...beforeItems.entries()].find(
      ([, entry]) => entry.item.provenance?.scenarioId === tokenInfoScenario.id,
    );
    expect(tokenInfoEntry).toBeDefined();
    const [tokenInfoItemId] = tokenInfoEntry!;
    expect(afterItems.get(tokenInfoItemId)).toEqual(beforeItems.get(tokenInfoItemId));
  });

  it("drops the second scheme's variable once no exported operation references it, while credentialProducers stays the same", () => {
    const withBoth = exportOfAuth(
      testModelOf(issueTokenScenario, tokenInfoScenario, issueAdminTokenScenario, adminReportsScenario),
    );
    const withoutAdmin = exportOfAuth(testModelOf(issueTokenScenario, tokenInfoScenario));

    expect(withBoth.environment.values.map((value) => value.key)).toContain("adminToken");
    expect(withoutAdmin.environment.values.map((value) => value.key)).not.toContain("adminToken");
    expect(withoutAdmin.credentialProducers).toEqual(withBoth.credentialProducers);
  });
});

describe("re-export stability for array/object query parameter serialization (specs/022-openapi-parameter-serialization, SC-004)", () => {
  const parameterTestModel: TestModel = {
    scenarios: [
      {
        id: "scenario-sort",
        category: "positive",
        operationPath: sortDefaultOperation.path,
        operationMethod: sortDefaultOperation.method,
        request: { pathParameters: {}, queryParameters: { sort: ["name", "-price"] }, headers: {} },
        assertions: [{ type: "status-code", expectedStatusCode: "200" }],
        provenance: { source: "RULE", rule: "positive", description: "GET /catalog with sort.", duplicateOfRules: [] },
      },
      {
        id: "scenario-filter",
        category: "positive",
        operationPath: filterDeepObjectOperation.path,
        operationMethod: filterDeepObjectOperation.method,
        request: {
          pathParameters: {},
          queryParameters: { filter: { status: "active", owner: "alice" } },
          headers: {},
        },
        assertions: [{ type: "status-code", expectedStatusCode: "200" }],
        provenance: { source: "RULE", rule: "positive", description: "GET /catalog/filter with filter.", duplicateOfRules: [] },
      },
    ],
  };

  it("produces byte-identical repeated-key and deepObject query rendering across repeated exports", () => {
    const outcomeFirst = generateCollection(parameterApiModel, parameterTestModel);
    const outcomeSecond = generateCollection(parameterApiModel, parameterTestModel);
    if (!outcomeFirst.ok || !outcomeSecond.ok) throw new Error("expected successful exports");
    expect(serializeArtifact(outcomeSecond.result.collection)).toBe(serializeArtifact(outcomeFirst.result.collection));
    expect(serializeArtifact(outcomeSecond.result.environment)).toBe(serializeArtifact(outcomeFirst.result.environment));
  });
});
