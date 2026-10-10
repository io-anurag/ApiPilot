import type {
  ApiModel,
  ApiOperation,
  ExecutionRun,
  NotAttemptedReason,
  SchemaConstraint,
  TestScenario,
  UploadedCollectionExecutionRun,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import { toOperationKey } from "@apipilot/shared-domain";
import { assertionTestPlan } from "../../../src/postman/assertionScripts";
import { itemIdForScenario } from "../../../src/postman/identifiers";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import type { CoverageInput, CoverageScenario } from "../../../src/apiCoverage/calculateCoverage";

const schema = (over: Partial<SchemaConstraint> = {}): SchemaConstraint => ({ required: [], properties: {}, ...over });

const orderSchema = schema({
  type: "object",
  required: ["sku", "quantity"],
  properties: {
    sku: schema({ type: "string", format: "uuid" }),
    quantity: schema({ type: "integer", minimum: 1, maximum: 100 }),
    status: schema({ type: "string", enum: ["new", "paid"] }),
    notes: schema({ type: "string", maxLength: 20 }),
  },
});

/**
 * Orders API: GET and DELETE share a path (separate operations), an enum, numeric bounds,
 * documented 2xx/4xx/default responses with and without schemas, a cookie parameter, and a
 * declared security requirement.
 */
export const ordersApiModel: ApiModel = {
  operations: [
    {
      path: "/orders",
      method: "POST",
      operationId: "createOrder",
      parameters: [],
      requestBody: { required: true, contentTypes: { "application/json": orderSchema } },
      responses: [
        { statusCode: "201", description: "Created", contentTypes: { "application/json": orderSchema }, examples: {} },
        { statusCode: "400", description: "Invalid", contentTypes: {}, examples: {} },
        { statusCode: "422", description: "Unprocessable", contentTypes: {}, examples: {} },
      ],
      security: [{ schemes: [{ name: "bearer", scopes: [] }] }],
      tags: [],
    },
    {
      path: "/orders",
      method: "GET",
      operationId: "listOrders",
      parameters: [
        { name: "limit", location: "query", required: false, schema: schema({ type: "integer", minimum: 1, maximum: 50 }) },
        { name: "session", location: "cookie", required: false, schema: schema({ type: "string" }) },
      ],
      requestBody: undefined,
      responses: [
        { statusCode: "200", description: "OK", contentTypes: { "application/json": schema({ type: "array" }) }, examples: {} },
      ],
      security: [],
      tags: [],
    },
    {
      path: "/orders/{id}",
      method: "GET",
      operationId: "getOrder",
      parameters: [{ name: "id", location: "path", required: true, schema: schema({ type: "string" }) }],
      requestBody: undefined,
      responses: [
        { statusCode: "200", description: "OK", contentTypes: { "application/json": orderSchema }, examples: {} },
        { statusCode: "404", description: "Not found", contentTypes: {}, examples: {} },
        { statusCode: "default", description: "Error", contentTypes: {}, examples: {} },
      ],
      security: [],
      tags: [],
    },
    {
      path: "/orders/{id}",
      method: "DELETE",
      operationId: "deleteOrder",
      parameters: [{ name: "id", location: "path", required: true, schema: schema({ type: "string" }) }],
      requestBody: undefined,
      responses: [
        { statusCode: "204", description: "Deleted", contentTypes: {}, examples: {} },
        { statusCode: "404", description: "Not found", contentTypes: {}, examples: {} },
      ],
      security: [{ schemes: [{ name: "bearer", scopes: [] }] }],
      tags: [],
    },
  ],
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  summary: { operationCount: 4, schemaCount: 3, securitySchemeCount: 1, issues: [] },
  info: { title: "Orders API", version: "1.0.0" },
};

export const FIXED_NOW = new Date("2026-10-10T12:00:00.000Z");

/** Deterministic scenarios for the fixture, with stable ids (the designer's own ids are random). */
export function ordersScenarios(apiModel: ApiModel = ordersApiModel): TestScenario[] {
  return generateTestModel(apiModel).scenarios.map((scenario, index) => ({
    ...scenario,
    id: `s${String(index + 1).padStart(3, "0")}`,
  }));
}

export function asCoverageScenarios(
  scenarios: TestScenario[],
  state: CoverageScenario["reviewState"] = "accepted",
): CoverageScenario[] {
  return scenarios.map((scenario) => ({ scenario, reviewState: state }));
}

export function baseInput(over: Partial<CoverageInput> = {}): CoverageInput {
  const scenarios = over.scenarios ?? asCoverageScenarios(ordersScenarios());
  return {
    apiModel: ordersApiModel,
    workflowId: "wf-1",
    specificationFilename: "orders.yaml",
    scenarios,
    uploadedRuns: [],
    guidedRuns: [],
    now: FIXED_NOW,
    ...over,
  };
}

export function scenariosOf(operation: Pick<ApiOperation, "method" | "path">, scenarios: TestScenario[]): TestScenario[] {
  const key = toOperationKey(operation);
  return scenarios.filter((s) => toOperationKey({ method: s.operationMethod, path: s.operationPath }) === key);
}

export interface UploadedRunOptions {
  id?: string;
  startedAt?: string;
  /** Scenario ids whose run fails an assertion (the first assertion test fails). */
  failing?: ReadonlySet<string>;
  /** Scenario ids whose request was edited before the run. */
  edited?: ReadonlySet<string>;
  /** Scenario ids that get no response (connectivity failure). */
  noResponse?: ReadonlySet<string>;
  /** Scenario ids reported as not attempted. */
  notAttempted?: ReadonlySet<string>;
  /** Scenario ids that ran but whose test results are missing. */
  noTests?: ReadonlySet<string>;
  /** Scenario ids whose status check passes but whose schema-conformance check fails. */
  schemaFailing?: ReadonlySet<string>;
  /** Scenario ids whose schema-conformance test result is missing (the check could not be evaluated). */
  missingSchemaTest?: ReadonlySet<string>;
  /** Scenario ids that time out (no response). */
  timeout?: ReadonlySet<string>;
  /** Collection name and tier recorded on the run: the only environment signal an uploaded run carries. */
  collection?: { name: string; tier: "local" | "staging" | "production" };
}

/** An uploaded-collection run executing `scenarios`, with every assertion passing unless told otherwise. */
export function uploadedRun(scenarios: TestScenario[], options: UploadedRunOptions = {}): UploadedCollectionExecutionRun {
  const startedAt = options.startedAt ?? "2026-10-10T11:00:00.000Z";
  const results: UploadedRequestResult[] = scenarios.map((scenario) => {
    const base = {
      requestName: scenario.id,
      requestMethod: scenario.operationMethod,
      startedAt,
      durationMs: 10,
      itemId: itemIdForScenario(scenario.id),
      ...(options.edited?.has(scenario.id) ? { wasEdited: true } : {}),
    };
    if (options.notAttempted?.has(scenario.id)) {
      return { ...base, outcome: "not-attempted", notAttemptedReason: "cancelled", durationMs: 0, testOutcomes: [] } as UploadedRequestResult;
    }
    if (options.noResponse?.has(scenario.id)) {
      return { ...base, outcome: "failed", failureCategory: "connectivity-failure", testOutcomes: [] } as UploadedRequestResult;
    }
    if (options.timeout?.has(scenario.id)) {
      return { ...base, outcome: "failed", failureCategory: "timeout", testOutcomes: [] } as UploadedRequestResult;
    }
    const plan = assertionTestPlan(scenario);
    const statusFailing = options.failing?.has(scenario.id) === true;
    const schemaFailing = options.schemaFailing?.has(scenario.id) === true;
    const failing = statusFailing || schemaFailing;
    const testOutcomes = options.noTests?.has(scenario.id)
      ? []
      : plan
          .filter((entry) => !(options.missingSchemaTest?.has(scenario.id) && entry.assertion.type === "schema-conformance"))
          .map((entry, i) => ({
            name: entry.testName,
            outcome:
              (statusFailing && i === 0) || (schemaFailing && entry.assertion.type === "schema-conformance")
                ? ("failed" as const)
                : ("passed" as const),
          }));
    return {
      ...base,
      outcome: failing ? "failed" : "passed",
      ...(failing ? { failureCategory: "assertion-failed" as const } : {}),
      responseStatusCode: 200,
      testOutcomes,
    } as UploadedRequestResult;
  });
  return {
    id: options.id ?? "run-1",
    source: "uploaded",
    uploadedCollectionSetId: "set-1",
    uploadedCollectionSnapshot: options.collection ?? { name: "Orders collection", tier: "local" },
    status: "completed",
    startedAt,
    completedAt: startedAt,
    summary: { total: results.length, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
    results,
    cancelRequested: false,
  };
}

/** A guided-workflow run with per-assertion outcomes recorded by index. */
export function guidedRun(
  scenarios: TestScenario[],
  options: {
    id?: string;
    startedAt?: string;
    failing?: ReadonlySet<string>;
    /** Scenario ids reported as not attempted, with the recorded reason. */
    notAttempted?: ReadonlyMap<string, NotAttemptedReason>;
    environment?: { name: string; tier: "local" | "staging" | "production" };
  } = {},
): ExecutionRun {
  const startedAt = options.startedAt ?? "2026-10-10T11:30:00.000Z";
  return {
    id: options.id ?? "grun-1",
    workflowId: "wf-1",
    environmentId: "env-1",
    environmentSnapshot: { name: options.environment?.name ?? "Staging", tier: options.environment?.tier ?? "staging", baseUrl: "https://example.test" },
    status: "completed",
    startedAt,
    completedAt: startedAt,
    summary: { total: scenarios.length, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
    results: scenarios.map((scenario) => {
      const failing = options.failing?.has(scenario.id) === true;
      const reason = options.notAttempted?.get(scenario.id);
      if (reason) {
        return {
          scenarioId: scenario.id,
          operationPath: scenario.operationPath,
          operationMethod: scenario.operationMethod,
          outcome: "not-attempted" as const,
          notAttemptedReason: reason,
          startedAt,
          durationMs: 0,
          assertionOutcomes: [],
          processingStage: "not-sent" as const,
        };
      }
      return {
        scenarioId: scenario.id,
        operationPath: scenario.operationPath,
        operationMethod: scenario.operationMethod,
        outcome: failing ? ("failed" as const) : ("passed" as const),
        ...(failing ? { failureCategory: "assertion-failed" as const } : {}),
        startedAt,
        durationMs: 5,
        responseStatusCode: 200,
        assertionOutcomes: scenario.assertions.map((a, assertionIndex) => ({
          assertionIndex,
          type: a.type,
          outcome: failing && assertionIndex === 0 ? ("failed" as const) : ("passed" as const),
        })),
        processingStage: "response-received" as const,
      };
    }),
    cancelRequested: false,
  };
}

/** Finds one scenario by operation, rule and optional target field. Throws so a typo fails loudly. */
export function findScenario(
  scenarios: TestScenario[],
  method: string,
  path: string,
  rule: string,
  targetField?: string,
): TestScenario {
  const found = scenarios.find(
    (s) =>
      s.operationMethod === method &&
      s.operationPath === path &&
      s.provenance.source === "RULE" &&
      s.provenance.rule === rule &&
      (targetField === undefined || s.targetField === targetField),
  );
  if (!found) throw new Error(`No scenario ${method} ${path} ${rule} ${targetField ?? ""}`);
  return found;
}
