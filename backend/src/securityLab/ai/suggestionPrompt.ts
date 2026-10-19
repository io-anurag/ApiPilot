import type { ApiOperation, EffectiveSecurity, InferenceRequest } from "@apipilot/shared-domain";
import { EXPECTED_BEHAVIOR_KINDS, INJECTION_PROBE_IDS, LEAK_PATTERN_IDS } from "@apipilot/shared-domain";
import { primaryRequestBodySchema, walkFields } from "../../testDesign/requestHelpers";
import { operationKeyOf, schemeNamesOf } from "../analysis/effectiveSecurity";
import { PRODUCT_RULES } from "../scenarios/productRules";

/**
 * Versioned prompt for optional AI-suggested security scenarios (specs/057 FR-064, research R17, constitution XXIII).
 *
 * The model is a **suggester**, never an actor. It chooses only from the closed vocabulary listed here (the same
 * mutations and conditions every scenario uses) and names operations from the digest it is given. What it returns is
 * a candidate that passes through the same strict validator as a generated or an edited scenario, is stored as a draft,
 * and must be reviewed and approved before anything is sent. The prompt never carries a credential, a response, an
 * evidence record or a URL: only the shape of the operations.
 */

/** Bump whenever the system prompt, task, vocabulary or answer format changes. v1: first version. */
export const SECURITY_SUGGESTION_RESPONSE_VERSION = 1;
/** Fits a handful of compact suggestions. */
export const SECURITY_SUGGESTION_MAX_OUTPUT_TOKENS = 700;
/** The most operations described to the model in one request, to keep the prompt within a small model's budget. */
export const MAX_PROMPT_OPERATIONS = 8;
const MAX_FIELDS_PER_OPERATION = 12;

export const SECURITY_SUGGESTION_SYSTEM_PROMPT =
  "You suggest API security test scenarios. Your entire response must be one complete valid JSON object, starting " +
  "with { and ending with }, with no markdown, backticks or commentary. Use only the operations, mutation kinds, " +
  "condition kinds and rule ids you are given. Never invent operations, fields, URLs, hosts, headers, credentials or " +
  "status codes. Each suggestion is only a proposal that a person will review.";

const TASK =
  "Suggest up to five security test scenarios for the operations below, each exercising one idea the fixed " +
  "scenario generator does not already cover well. Every suggestion names one operationKey from operations and one " +
  "categoryId from categories, and uses only the mutation kinds and condition kinds in vocabulary. Ground each " +
  "expected behavior either in a product rule id from vocabulary.productRules, or in status codes the operation " +
  "documents (documentedStatusCodes must be among its documentedResponses). Put a confidence between 0 and 1 and a short " +
  "list of the assumptions you made. If nothing useful can be suggested, answer with an empty suggestions array.";

/** The closed vocabulary, listed as shapes. Placeholders only: no concrete value a small model can copy everywhere. */
const VOCABULARY = {
  mutations: [
    { kind: "auth.omit" },
    { kind: "auth.invalid-token" },
    { kind: "auth.malformed" },
    { kind: "auth.expired", identity: "<role label>" },
    { kind: "identity.swap", from: "<role label>", to: "<role label>" },
    { kind: "path-id.substitute", parameter: "<path parameter name>", ownerIdentity: "<role label>" },
    { kind: "body.add-property", path: "<dotted parent path or empty>", name: "<property name>", valueKind: "string | number | boolean | protected-example" },
    { kind: "field.violate-constraint", path: "<body:dotted.path | query:name | path:name | header:name>", constraint: "type | format | enum | minimum | maximum | minLength | maxLength | minItems | maxItems | required" },
    { kind: "method.probe", method: "HEAD | OPTIONS | TRACE" },
    { kind: "request.repeat", count: "<2 to 50>" },
    { kind: "input.injection-probe", path: "<query:name of a string query parameter>", probeId: INJECTION_PROBE_IDS.join(" | ") },
  ],
  conditions: [
    { kind: "status.not-success" },
    { kind: "status.in-set", codes: ["<status code>"] },
    { kind: "status.equals", code: "<status code>" },
    { kind: "status.not-equals", code: "<status code>" },
    { kind: "header.present", name: "<header name>" },
    { kind: "header.absent", name: "<header name>" },
    { kind: "body.field-absent", path: "<dotted path>" },
    { kind: "body.field-present", path: "<dotted path>" },
    { kind: "body.not-match-leak-pattern", patternId: LEAK_PATTERN_IDS.join(" | ") },
  ],
  expectedKinds: [...EXPECTED_BEHAVIOR_KINDS],
  productRules: Object.keys(PRODUCT_RULES),
};

const ANSWER_FORMAT = {
  responseVersion: SECURITY_SUGGESTION_RESPONSE_VERSION,
  suggestions: [
    {
      operationKey: "<operationKey from operations>",
      categoryId: "<categoryId from categories>",
      title: "<short title>",
      objective: "<what the scenario checks>",
      rationale: "<why the specification makes this worth checking>",
      impact: "<what could go wrong if the service gets it wrong>",
      mutations: ["<mutation object from vocabulary.mutations>"],
      expected: { kind: "<one of vocabulary.expectedKinds>", ruleId: "<id from vocabulary.productRules, or omit>", documentedStatusCodes: ["<documented status code, or omit>"] },
      conditions: ["<condition object from vocabulary.conditions>"],
      confidence: "<number between 0 and 1>",
      assumptions: ["<each assumption, as plain text>"],
    },
  ],
};

export interface OperationDigest {
  readonly operationKey: string;
  readonly security: string;
  readonly parameters: ReadonlyArray<{ location: string; name: string; type: string; required: boolean }>;
  readonly bodyFields: ReadonlyArray<{ path: string; type: string; required: boolean; readOnly: boolean }>;
  readonly documentedResponses: readonly number[];
}

/** What the model is told about one operation: its shape, never an example value or a response. */
export function digestOperation(operation: ApiOperation, effective: EffectiveSecurity | undefined): OperationDigest {
  const schema = primaryRequestBodySchema(operation);
  const fields = schema ? [...walkFields(schema)].slice(0, MAX_FIELDS_PER_OPERATION) : [];
  const schemes = effective && (effective.source === "operation" || effective.source === "root") ? schemeNamesOf(effective.requirement) : [];
  return {
    operationKey: operationKeyOf(operation),
    security: schemes.length > 0 ? `requires ${schemes.join(" or ")}` : "no credentials required",
    parameters: operation.parameters.map((parameter) => ({ location: parameter.location, name: parameter.name, type: parameter.schema.type ?? "unspecified", required: parameter.required })),
    bodyFields: fields.map((field) => ({ path: field.path, type: field.schema.type ?? "unspecified", required: field.required, readOnly: field.schema.readOnly === true })),
    documentedResponses: operation.responses.map((response) => Number(response.statusCode)).filter((code) => Number.isInteger(code)).sort((a, b) => a - b),
  };
}

export interface SuggestionPromptInput {
  readonly operations: readonly OperationDigest[];
  readonly categories: readonly string[];
}

export function buildSuggestionPrompt(input: SuggestionPromptInput): string {
  return JSON.stringify({
    task: TASK,
    vocabulary: VOCABULARY,
    categories: input.categories,
    operations: input.operations.slice(0, MAX_PROMPT_OPERATIONS),
    answerFormat: ANSWER_FORMAT,
  });
}

export function buildSuggestionRequest(requestId: string, input: SuggestionPromptInput): InferenceRequest {
  return {
    contractVersion: 1,
    requestId,
    input: buildSuggestionPrompt(input),
    expectedOutputFormat: "json",
    maxOutputTokens: SECURITY_SUGGESTION_MAX_OUTPUT_TOKENS,
    systemPrompt: SECURITY_SUGGESTION_SYSTEM_PROMPT,
  };
}
