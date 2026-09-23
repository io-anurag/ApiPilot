import { describe, expect, it } from "vitest";
import { matchSpecificationContext } from "../../../src/failureAnalysis/matchSpecificationContext";
import {
  CHAINED_ITEM_ID,
  CREATE_STEP_ITEM_ID,
  GET_STEP_ITEM_ID,
  RELATIONSHIP_ID,
  STANDALONE_ITEM_ID,
  STANDALONE_SCENARIO_ID,
  TOKEN_FETCH_ITEM_ID,
  WORKFLOW_ID,
  completedWorkflow,
  resultFor,
} from "../../fixtures/failureAnalysis/workflowFixtures";

describe("matchSpecificationContext — identity matching (FR-018)", () => {
  it("is unavailable with no-request-identity when the result predates item tracking", () => {
    const result = resultFor(undefined, "failed");
    expect(matchSpecificationContext(result, completedWorkflow(), [result], 0)).toEqual({
      status: "unavailable",
      reason: "no-request-identity",
    });
  });

  it("is unavailable with no-generated-collection when there is no workflow or no artifact", () => {
    const result = resultFor(STANDALONE_ITEM_ID, "failed");
    const withoutArtifact = { ...completedWorkflow(), postmanArtifact: undefined };

    expect(matchSpecificationContext(result, undefined, [result], 0)).toEqual({
      status: "unavailable",
      reason: "no-generated-collection",
    });
    expect(matchSpecificationContext(result, withoutArtifact, [result], 0)).toEqual({
      status: "unavailable",
      reason: "no-generated-collection",
    });
  });

  it("is unavailable with not-generated-by-current-workflow for an unknown id", () => {
    const result = resultFor("11111111-2222-5333-8444-555555555555", "failed");
    expect(matchSpecificationContext(result, completedWorkflow(), [result], 0)).toEqual({
      status: "unavailable",
      reason: "not-generated-by-current-workflow",
    });
  });

  it("is unavailable with no-originating-scenario for an item without scenario provenance", () => {
    const result = resultFor(TOKEN_FETCH_ITEM_ID, "failed");
    expect(matchSpecificationContext(result, completedWorkflow(), [result], 0)).toEqual({
      status: "unavailable",
      reason: "no-originating-scenario",
    });
  });

  it("matches a standalone item to its operation, scenario and documented responses", () => {
    const result = resultFor(STANDALONE_ITEM_ID, "failed");
    expect(matchSpecificationContext(result, completedWorkflow(), [result], 0)).toEqual({
      status: "matched",
      workflowId: "tgw-1",
      scenarioId: STANDALONE_SCENARIO_ID,
      scenarioName: "GET /users with valid input",
      scenarioCategory: "positive",
      operationPath: "/users",
      operationMethod: "GET",
      documentedStatusCodes: ["200"],
      requestEditedAfterGeneration: false,
      upstream: [],
    });
  });

  it("reports an edited request", () => {
    const result = resultFor(STANDALONE_ITEM_ID, "failed", { wasEdited: true });
    const context = matchSpecificationContext(result, completedWorkflow(), [result], 0);
    expect(context.status === "matched" && context.requestEditedAfterGeneration).toBe(true);
  });

  it("never matches by request name, even when names are identical", () => {
    const result = resultFor(undefined, "failed", { requestName: "GET /users — positive" });
    expect(matchSpecificationContext(result, completedWorkflow(), [result], 0).status).toBe(
      "unavailable",
    );
  });
});

describe("matchSpecificationContext — upstream context (FR-004)", () => {
  it("names the upstream workflow step and its failed outcome in the same run", () => {
    const runResults = [resultFor(CREATE_STEP_ITEM_ID, "failed"), resultFor(GET_STEP_ITEM_ID, "failed")];
    const context = matchSpecificationContext(runResults[1], completedWorkflow(), runResults, 1);

    expect(context.status).toBe("matched");
    expect(context.status === "matched" && context.upstream).toEqual([
      {
        via: "integration-workflow",
        stepPosition: 0,
        operationPath: "/users",
        operationMethod: "POST",
        suppliedFields: ["user_id"],
        outcomeInRun: "failed",
      },
    ]);
  });

  it.each([
    ["passed", "passed"],
    ["not-attempted", "not-attempted"],
  ] as const)("reports an upstream step that %s", (outcome, expected) => {
    const runResults = [resultFor(CREATE_STEP_ITEM_ID, outcome), resultFor(GET_STEP_ITEM_ID, "failed")];
    const context = matchSpecificationContext(runResults[1], completedWorkflow(), runResults, 1);
    expect(context.status === "matched" && context.upstream[0]?.outcomeInRun).toBe(expected);
  });

  it("reports not-in-run when the upstream step is absent from the run", () => {
    const runResults = [resultFor(GET_STEP_ITEM_ID, "failed")];
    const context = matchSpecificationContext(runResults[0], completedWorkflow(), runResults, 0);
    expect(context.status === "matched" && context.upstream[0]?.outcomeInRun).toBe("not-in-run");
  });

  it("ignores an upstream step that runs after the failed request", () => {
    const runResults = [resultFor(GET_STEP_ITEM_ID, "failed"), resultFor(CREATE_STEP_ITEM_ID, "passed")];
    const context = matchSpecificationContext(runResults[0], completedWorkflow(), runResults, 0);
    expect(context.status === "matched" && context.upstream[0]?.outcomeInRun).toBe("not-in-run");
  });

  it("resolves a dependency relationship's producer and the nearest preceding outcome for it", () => {
    const runResults = [
      resultFor(CREATE_STEP_ITEM_ID, "passed"),
      resultFor(CREATE_STEP_ITEM_ID, "failed"),
      resultFor(CHAINED_ITEM_ID, "failed"),
    ];
    const context = matchSpecificationContext(runResults[2], completedWorkflow(), runResults, 2);

    expect(context.status === "matched" && context.upstream).toEqual([
      {
        via: "dependency-relationship",
        operationPath: "/users",
        operationMethod: "POST",
        suppliedFields: ["id"],
        outcomeInRun: "failed",
      },
    ]);
  });

  it("never lists a request as its own upstream producer when it carries the workflow's relationship ids", () => {
    const workflow = completedWorkflow();
    const folder = workflow.postmanArtifact?.collection.item.find((entry) => entry.name.startsWith("Workflow:"));
    const createStep = folder?.item.find((item) => item.id === CREATE_STEP_ITEM_ID);
    if (createStep?.provenance) createStep.provenance.relationshipIds = [RELATIONSHIP_ID];

    const runResults = [resultFor(CREATE_STEP_ITEM_ID, "failed")];
    const context = matchSpecificationContext(runResults[0], workflow, runResults, 0);
    expect(context.status === "matched" && context.upstream).toEqual([]);
  });

  it("does not list upstream steps that supply nothing this request consumes", () => {
    const runResults = [resultFor(CREATE_STEP_ITEM_ID, "failed")];
    const context = matchSpecificationContext(runResults[0], completedWorkflow(), runResults, 0);
    expect(context.status === "matched" && context.upstream).toEqual([]);
  });

  it("is deterministic", () => {
    const runResults = [resultFor(CREATE_STEP_ITEM_ID, "failed"), resultFor(GET_STEP_ITEM_ID, "failed")];
    const first = matchSpecificationContext(runResults[1], completedWorkflow(), runResults, 1);
    const second = matchSpecificationContext(runResults[1], completedWorkflow(), runResults, 1);
    expect(first).toEqual(second);
    expect(first.status === "matched" && first.workflowId).toBe("tgw-1");
    expect(WORKFLOW_ID).toBe("workflow-users");
  });
});
