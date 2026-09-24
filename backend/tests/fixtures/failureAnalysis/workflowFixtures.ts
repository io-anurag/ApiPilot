import { POSTMAN_COLLECTION_SCHEMA } from "@apipilot/shared-domain";
import type {
  ApiModel,
  ApiOperation,
  DependencyAnalysisResult,
  PostmanCollection,
  PostmanRequestItem,
  TestModel,
  TestScenario,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import type { SpecificationContextSource } from "../../../src/failureAnalysis/matchSpecificationContext";
import {
  itemIdForOAuth2TokenFetch,
  itemIdForScenario,
  itemIdForWorkflowStep,
} from "../../../src/postman/identifiers";
import { integrationWorkflow, workflowStep, workflowVariable } from "../postman/workflowFixtures";

export const WORKFLOW_ID = "workflow-users";
export const CREATE_SCENARIO_ID = "scenario-create-user";
export const GET_SCENARIO_ID = "scenario-get-user";
export const STANDALONE_SCENARIO_ID = "scenario-list-users";
export const RELATIONSHIP_ID = "rel-user-id";

export const CREATE_STEP_ITEM_ID = itemIdForWorkflowStep(WORKFLOW_ID, 0, CREATE_SCENARIO_ID);
export const GET_STEP_ITEM_ID = itemIdForWorkflowStep(WORKFLOW_ID, 1, GET_SCENARIO_ID);
export const STANDALONE_ITEM_ID = itemIdForScenario(STANDALONE_SCENARIO_ID);
export const CHAINED_ITEM_ID = itemIdForScenario(GET_SCENARIO_ID);
export const TOKEN_FETCH_ITEM_ID = itemIdForOAuth2TokenFetch("oauth");

function operation(method: string, path: string, statusCodes: string[]): ApiOperation {
  return {
    path,
    method,
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: statusCodes.map((statusCode) => ({
      statusCode,
      description: statusCode,
      contentTypes: {},
      examples: {},
    })),
    security: [],
    tags: [],
  };
}

function scenario(id: string, method: string, path: string, expectedStatusCode: string): TestScenario {
  return {
    id,
    operationPath: path,
    operationMethod: method,
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [{ type: "status-code", expectedStatusCode }],
    provenance: {
      source: "RULE",
      rule: "positive",
      description: `${method} ${path} with valid input`,
      duplicateOfRules: [],
    },
  };
}

const apiModel: ApiModel = {
  operations: [
    operation("POST", "/users", ["201", "400"]),
    operation("GET", "/users/{id}", ["200", "404"]),
    operation("GET", "/users", ["200"]),
  ],
  securitySchemes: {},
  summary: { operationCount: 3, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

const approvedTestModel: TestModel = {
  scenarios: [
    scenario(CREATE_SCENARIO_ID, "POST", "/users", "201"),
    scenario(GET_SCENARIO_ID, "GET", "/users/{id}", "200"),
    scenario(STANDALONE_SCENARIO_ID, "GET", "/users", "200"),
  ],
};

const userIdVariable = workflowVariable("user_id", 0, "id", 1, "path", "id", RELATIONSHIP_ID);

const dependencyAnalysis: DependencyAnalysisResult = {
  requestId: "dep-test",
  graph: {
    relationships: [
      {
        id: RELATIONSHIP_ID,
        producer: { operationPath: "/users", operationMethod: "POST", field: "id" },
        consumer: { operationPath: "/users/{id}", operationMethod: "GET", field: "id", location: "path" },
        confidence: "CONFIRMED",
        source: "deterministic",
        explanation: "id produced by POST /users is consumed by GET /users/{id}",
      },
    ],
  },
  workflows: [
    integrationWorkflow(
      WORKFLOW_ID,
      [
        workflowStep(0, "POST", "/users", { producesVariableNames: ["user_id"] }),
        workflowStep(1, "GET", "/users/{id}", { consumesVariableNames: ["user_id"] }),
      ],
      [userIdVariable],
    ),
  ],
  manualConfirmationCandidates: [],
  cycles: [],
  aiOutcome: "success",
};

function requestItem(
  id: string,
  name: string,
  method: string,
  path: string,
  provenance?: PostmanRequestItem["provenance"],
): PostmanRequestItem {
  return {
    id,
    name,
    request: {
      method,
      url: {
        raw: `{{baseUrl}}${path}`,
        host: ["{{baseUrl}}"],
        path: path.split("/").filter(Boolean),
        query: [],
        variable: [],
      },
      header: [],
    },
    ...(provenance ? { provenance } : {}),
  };
}

export function generatedCollection(): PostmanCollection {
  return {
    info: {
      name: "Users API",
      _postman_id: "collection-users",
      schema: POSTMAN_COLLECTION_SCHEMA,
    },
    item: [
      {
        name: "OAuth2 Token Setup",
        item: [requestItem(TOKEN_FETCH_ITEM_ID, "Fetch token", "POST", "/token")],
      },
      {
        name: `Workflow: ${WORKFLOW_ID}`,
        item: [
          requestItem(CREATE_STEP_ITEM_ID, "POST /users — workflow step 1", "POST", "/users", {
            scenarioId: CREATE_SCENARIO_ID,
            workflowId: WORKFLOW_ID,
            stepPosition: 0,
          }),
          requestItem(GET_STEP_ITEM_ID, "GET /users/{id} — workflow step 2", "GET", "/users/{id}", {
            scenarioId: GET_SCENARIO_ID,
            workflowId: WORKFLOW_ID,
            stepPosition: 1,
          }),
        ],
      },
      {
        name: "users",
        item: [
          requestItem(STANDALONE_ITEM_ID, "GET /users — positive", "GET", "/users", {
            scenarioId: STANDALONE_SCENARIO_ID,
          }),
          requestItem(CHAINED_ITEM_ID, "GET /users/{id} — positive", "GET", "/users/{id}", {
            scenarioId: GET_SCENARIO_ID,
            relationshipIds: [RELATIONSHIP_ID],
          }),
        ],
      },
    ],
  };
}

export function completedWorkflow(): SpecificationContextSource {
  return {
    id: "tgw-1",
    apiModel,
    approvedTestModel,
    dependencyAnalysis,
    postmanArtifact: { collection: generatedCollection() },
  };
}

export function resultFor(
  itemId: string | undefined,
  outcome: UploadedRequestResult["outcome"],
  overrides: Partial<UploadedRequestResult> = {},
): UploadedRequestResult {
  return {
    requestName: "a request",
    requestMethod: "GET",
    outcome,
    ...(outcome === "failed" ? { failureCategory: "assertion-failed" as const } : {}),
    ...(outcome === "not-attempted" ? { notAttemptedReason: "cancelled" as const } : {}),
    startedAt: new Date(0).toISOString(),
    durationMs: outcome === "not-attempted" ? 0 : 10,
    testOutcomes: [],
    ...(itemId ? { itemId } : {}),
    ...overrides,
  };
}
