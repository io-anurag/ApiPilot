import type { ApiModel, ApiOperation, Response, SchemaConstraint } from "@apipilot/shared-domain";
import { parseAIScenarioResponse } from "../../testDesign/parseAIScenarioResponse";
import { buildAIScenarioRequest } from "../../testDesign/aiScenarioPrompt";
import { generateTestModel } from "../../testDesign/generateTestModel";
import {
  stripUndocumentedStatusAssertions,
  validateAICandidateSemantics,
  validateAICandidateShape,
} from "../../testDesign/validateAICandidate";

/** One generation workload used by the benchmarking harness. */
export interface BenchmarkWorkload {
  id: string;
  input: string;
  expectedOutputFormat: "text" | "json";
  /** Output allowance the real feature requests, so the benchmark measures the same limit. */
  maxOutputTokens?: number;
  /** Whether a reply counts as a success for this workload (see `isEnhancementReplyUsable`). */
  isUsable: (content: string | undefined) => boolean;
}

/**
 * Identifies this sample set (data-model.md `BenchmarkReport.workloadSetId`).
 *
 * Replaces `ap004-representative-v1`, whose three single-sentence prompts bore no resemblance to the
 * enhancement task: a recorded 33% success rate on them could not support a decision about that task
 * (specs/013-ai-enhancement-viability T025, constitution XXII). Reports written under the earlier id
 * are history and are not comparable with this set. `v2` widened the set from three operations to six:
 * on three, one model answer decided a third of the score. `v3` adds two operations with no parameters
 * and no request body, which the first six lacked: they exposed that a prompt listing no allowed
 * target left the model with nothing it was permitted to aim at, and it answered with no candidate.
 * Both document an alternative outcome (`409`) a candidate can exercise. An operation with no input and
 * a single documented response was tried first and dropped: there is nothing left to propose for it, so
 * an empty reply is the correct one, and this benchmark's rule that an empty reply is unusable would
 * have scored a right answer as a failure.
 */
export const WORKLOAD_SET_ID = "ap013-enhancement-v3";

const string = (extra: Partial<SchemaConstraint> = {}): SchemaConstraint => ({
  type: "string",
  required: [],
  properties: {},
  ...extra,
});

function response(statusCode: string, description: string, schema?: SchemaConstraint): Response {
  return {
    statusCode,
    description,
    contentTypes: schema ? { "application/json": schema } : {},
    examples: {},
  };
}

function modelOf(operation: ApiOperation): ApiModel {
  return {
    operations: [operation],
    securitySchemes: {},
    summary: { operationCount: 1, schemaCount: 1, securitySchemeCount: 0, issues: [] },
  };
}

/**
 * Six small, fixed operations spanning what enhancement reasons about: a format-constrained body
 * field, path/query parameters with an enumeration, a nested array body, a path-only delete, a
 * paginated list, a partial update combining a path parameter with a body, and two operations that take
 * no input at all. Fixed literals rather
 * than a parsed specification so the prompts are byte-stable (constitution VII, XXIII).
 */
/** The operations the enhancement workloads are built from; exported so a run's replies can be re-scored or diagnosed per operation. */
export const FIXTURES: { id: string; model: ApiModel }[] = [
  {
    id: "create-account",
    model: modelOf({
      path: "/accounts",
      method: "POST",
      operationId: "createAccount",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": {
            type: "object",
            required: ["email"],
            properties: {
              email: string({ format: "email" }),
              displayName: string({ minLength: 1, maxLength: 40 }),
            },
          },
        },
      },
      responses: [
        response("201", "Created", {
          type: "object",
          required: ["id"],
          properties: { id: string() },
        }),
        response("409", "An account with this email already exists"),
      ],
      security: [],
      tags: ["accounts"],
    }),
  },
  {
    id: "get-order",
    model: modelOf({
      path: "/orders/{orderId}",
      method: "GET",
      operationId: "getOrder",
      parameters: [
        { name: "orderId", location: "path", required: true, schema: string({ format: "uuid" }) },
        {
          name: "expand",
          location: "query",
          required: false,
          schema: string({ enum: ["items", "customer"] }),
        },
      ],
      requestBody: undefined,
      responses: [
        response("200", "The order", {
          type: "object",
          required: ["id", "status"],
          properties: { id: string(), status: string({ enum: ["open", "shipped"] }) },
        }),
        response("404", "No such order"),
      ],
      security: [],
      tags: ["orders"],
    }),
  },
  {
    id: "create-order",
    model: modelOf({
      path: "/orders",
      method: "POST",
      operationId: "createOrder",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": {
            type: "object",
            required: ["customerId", "items"],
            properties: {
              customerId: string(),
              items: {
                type: "array",
                required: [],
                properties: {},
                minItems: 1,
                items: {
                  type: "object",
                  required: ["sku", "quantity"],
                  properties: {
                    sku: string(),
                    quantity: { type: "integer", required: [], properties: {}, minimum: 1 },
                  },
                },
              },
            },
          },
        },
      },
      responses: [
        response("201", "Created", {
          type: "object",
          required: ["id"],
          properties: { id: string() },
        }),
        response("422", "The order is not valid"),
      ],
      security: [],
      tags: ["orders"],
    }),
  },
  {
    id: "delete-order",
    model: modelOf({
      path: "/orders/{orderId}",
      method: "DELETE",
      operationId: "deleteOrder",
      parameters: [
        { name: "orderId", location: "path", required: true, schema: string({ format: "uuid" }) },
      ],
      requestBody: undefined,
      responses: [response("204", "Deleted"), response("404", "No such order")],
      security: [],
      tags: ["orders"],
    }),
  },
  {
    id: "list-orders",
    model: modelOf({
      path: "/orders",
      method: "GET",
      operationId: "listOrders",
      parameters: [
        {
          name: "limit",
          location: "query",
          required: false,
          schema: { type: "integer", required: [], properties: {}, minimum: 1, maximum: 100 },
        },
        {
          name: "status",
          location: "query",
          required: false,
          schema: string({ enum: ["open", "shipped", "cancelled"] }),
        },
      ],
      requestBody: undefined,
      responses: [
        response("200", "A page of orders", {
          type: "array",
          required: [],
          properties: {},
          items: string(),
        }),
        response("400", "Invalid query"),
      ],
      security: [],
      tags: ["orders"],
    }),
  },
  {
    id: "update-account",
    model: modelOf({
      path: "/accounts/{accountId}",
      method: "PATCH",
      operationId: "updateAccount",
      parameters: [
        { name: "accountId", location: "path", required: true, schema: string({ format: "uuid" }) },
      ],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": {
            type: "object",
            required: [],
            properties: {
              displayName: string({ minLength: 1, maxLength: 40 }),
              email: string({ format: "email" }),
            },
          },
        },
      },
      responses: [response("200", "Updated"), response("404", "No such account")],
      security: [],
      tags: ["accounts"],
    }),
  },
  {
    id: "clear-cache",
    model: modelOf({
      path: "/cache",
      method: "DELETE",
      operationId: "clearCache",
      parameters: [],
      requestBody: undefined,
      responses: [response("204", "Cleared"), response("409", "A rebuild is in progress")],
      security: [],
      tags: ["admin"],
    }),
  },
  {
    id: "start-reindex",
    model: modelOf({
      path: "/reindex",
      method: "POST",
      operationId: "startReindex",
      parameters: [],
      requestBody: undefined,
      responses: [response("202", "Accepted"), response("409", "A reindex is already running")],
      security: [],
      tags: ["admin"],
    }),
  },
];

/**
 * Whether `content` is a usable reply to an enhancement prompt: it parses under the response
 * contract (the same `parseAIScenarioResponse` the pipeline uses) and holds at least one candidate
 * that passes shape and semantic validation against `apiModel` — i.e. one the pipeline would retain.
 *
 * Judged per candidate, not per reply, because the pipeline keeps valid candidates alongside invalid
 * ones (specs/005 FR-007, FR-012). An empty list is not usable: every workload here has obvious
 * scenarios, and a model that always answers "none" must not be able to score well.
 */
export function isEnhancementReplyUsable(
  content: string | undefined,
  apiModel: ApiModel,
): boolean {
  if (!content) return false;
  let candidates: unknown[];
  try {
    candidates = parseAIScenarioResponse({
      contractVersion: 1,
      requestId: "benchmark",
      status: "success",
      content,
      modelId: "benchmark",
      provider: "local",
      durationMs: 0,
    }).candidates;
  } catch {
    return false;
  }
  return candidates.some((candidate) => {
    if (validateAICandidateShape(candidate).length > 0) return false;
    // Mirrors the pipeline: an undocumented status code costs the assertion, not the candidate.
    const { candidate: retained } = stripUndocumentedStatusAssertions(
      candidate as Parameters<typeof validateAICandidateSemantics>[0],
      apiModel,
    );
    return validateAICandidateSemantics(retained, apiModel).length === 0;
  });
}

/** Builds the enhancement workloads from the real prompt builder, so they cannot drift from the contract. */
export function buildEnhancementWorkloads(): BenchmarkWorkload[] {
  return FIXTURES.map(({ id, model }) => {
    const request = buildAIScenarioRequest(`benchmark-${id}`, model, generateTestModel(model));
    return {
      id,
      input: request.input,
      expectedOutputFormat: "json",
      maxOutputTokens: request.maxOutputTokens,
      isUsable: (content) => isEnhancementReplyUsable(content, model),
    };
  });
}

/** The fixed workload set benchmarked under `WORKLOAD_SET_ID`. */
export const ENHANCEMENT_WORKLOADS: BenchmarkWorkload[] = buildEnhancementWorkloads();
