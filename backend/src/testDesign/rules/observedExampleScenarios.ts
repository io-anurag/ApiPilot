import { isDeepStrictEqual } from "node:util";
import {
  OBSERVED_EVIDENCE_MIN_OBSERVATIONS,
  type ApiOperation,
  type GenerationNote,
  type GeneratedRequest,
  type ObservedRequestExample,
  type TestScenario,
} from "@apipilot/shared-domain";
import { cloneRequest, deleteAtPath, primaryRequestBodyContentType, setAtPath } from "../requestHelpers";
import { buildScenario } from "../scenario";
import { incompatibleTypeValue } from "../valueGenerators";

/**
 * Deterministic scenarios for an operation that was observed in captured traffic (specs/056 FR-035,
 * FR-036, contracts/observed-generation-rules.md). It reads only `operation.observed`:
 *
 * - one positive scenario per observed 2xx status, replaying the most-observed example for that
 *   status and asserting only that status, labelled observed (never a schema, header or body);
 * - `missing-field` and `invalid-type` negatives only for a field that the evidence supports in at
 *   least `OBSERVED_EVIDENCE_MIN_OBSERVATIONS` bodies, labelled inference-derived, with no expected
 *   failure status unless an observed failure had exactly that request.
 *
 * Nothing observed is a boundary, enum or format, so no scenario of those kinds is generated.
 */

export interface ObservedRuleOutput {
  scenarios: TestScenario[];
  /** Why an operation produced no scenario at all (FR-040). Empty when it produced any. */
  notes: GenerationNote[];
}

const JSON_MEDIA_TYPE = /^(application|text)\/(json|[\w.+-]*\+json)$/;

function toRequest(example: ObservedRequestExample): GeneratedRequest {
  const request: GeneratedRequest = {
    pathParameters: structuredClone(example.pathParameters),
    queryParameters: structuredClone(example.queryParameters),
    headers: structuredClone(example.headers),
  };
  if (example.body !== undefined) request.body = structuredClone(example.body);
  return request;
}

function getAtPath(value: unknown, path: string): unknown {
  let cursor: unknown = value;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** An observed non-success example whose request is exactly `request`, or undefined (FR-036). */
function matchingFailure(examples: readonly ObservedRequestExample[], request: GeneratedRequest): ObservedRequestExample | undefined {
  return examples.find(
    (example) =>
      !example.responseStatus.startsWith("2") &&
      example.bodyUnavailable === undefined &&
      isDeepStrictEqual(example.pathParameters, request.pathParameters) &&
      isDeepStrictEqual(example.queryParameters, request.queryParameters) &&
      isDeepStrictEqual(example.body, request.body),
  );
}

export function observedExampleScenarios(operation: ApiOperation): ObservedRuleOutput {
  const observed = operation.observed;
  if (!observed) return { scenarios: [], notes: [] };

  const primary = primaryRequestBodyContentType(operation);
  const eligible = (example: ObservedRequestExample): boolean =>
    example.bodyUnavailable === undefined && (example.body === undefined || example.contentType === primary);

  const successStatuses = Object.keys(observed.statusCounts)
    .filter((status) => status.startsWith("2"))
    .sort((a, b) => Number(a) - Number(b));

  // 1. Positive scenarios, one per observed success status.
  const positives: { scenario: TestScenario; example: ObservedRequestExample; status: string }[] = [];
  for (const status of successStatuses) {
    const candidates = observed.requestExamples
      .filter((example) => example.responseStatus === status && eligible(example))
      .sort((a, b) => b.observations - a.observations || a.firstEntryIndex - b.firstEntryIndex);
    const example = candidates[0];
    if (!example) continue;
    const times = `${example.observations} ${plural(example.observations, "time", "times")}`;
    const scenario = buildScenario({
      operation,
      category: "positive",
      request: toRequest(example),
      assertionResult: { assertions: [{ type: "status-code", expectedStatusCode: status, basis: "observed" }] },
      rule: "observed-example-positive",
      description: `Replays the request observed ${times} in the capture, which returned ${status}.`,
    });
    positives.push({
      scenario: {
        ...scenario,
        evidence: {
          origin: "observed",
          observationCount: example.observations,
          derivation: "observed-example",
          summary: `Observed ${times} in the capture, returned ${status}.`,
        },
      },
      example,
      status,
    });
  }

  const scenarios: TestScenario[] = positives.map((positive) => positive.scenario);

  // 2 and 3. Evidence-gated negatives, built on the most-observed positive example.
  const base = [...positives].sort((a, b) => b.example.observations - a.example.observations || Number(a.status) - Number(b.status))[0];
  const evidence = primary !== undefined ? observed.requestBodyEvidence[primary] : undefined;
  if (base && evidence && base.example.body !== undefined && evidence.observations >= OBSERVED_EVIDENCE_MIN_OBSERVATIONS) {
    const isJson = primary !== undefined && JSON_MEDIA_TYPE.test(primary);
    for (const [path, field] of Object.entries(evidence.fields).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      // Evidence of array elements counts elements, not bodies, so it cannot support a threshold.
      if (path.includes("[]") || field.presentIn < OBSERVED_EVIDENCE_MIN_OBSERVATIONS) continue;
      if (getAtPath(base.example.body, path) === undefined) continue;

      if (field.presentIn === evidence.observations) {
        const request = cloneRequest(toRequest(base.example));
        request.body = deleteAtPath(request.body, path);
        scenarios.push(negative(operation, observed.requestExamples, request, {
          category: "missing-field",
          path,
          rule: "observed-field-omitted",
          description: `Omits ${path}, which was present in every one of the ${evidence.observations} observed request bodies.`,
          observations: field.presentIn,
          basis: `Field ${path} was present in ${field.presentIn} of ${evidence.observations} observed request bodies.`,
        }));
      }

      const types = Object.keys(field.types);
      if (isJson && types.length === 1 && types[0] !== "null" && field.types[types[0]] === field.presentIn) {
        const wrong = incompatibleTypeValue({ required: [], properties: {}, type: types[0] });
        if (wrong !== undefined) {
          const request = cloneRequest(toRequest(base.example));
          request.body = setAtPath(request.body, path, wrong);
          scenarios.push(negative(operation, observed.requestExamples, request, {
            category: "invalid-type",
            path,
            rule: "observed-field-type-violated",
            description: `Sets ${path} to a value of a different type than the ${types[0]} it had in all ${field.presentIn} observed bodies that carried it.`,
            observations: field.presentIn,
            basis: `Field ${path} was a ${types[0]} in all ${field.presentIn} observed request bodies that carried it.`,
          }));
        }
      }
    }
  }

  return { scenarios, notes: scenarios.length === 0 ? [noteFor(operation, successStatuses, primary)] : [] };
}

function negative(
  operation: ApiOperation,
  examples: readonly ObservedRequestExample[],
  request: GeneratedRequest,
  details: { category: "missing-field" | "invalid-type"; path: string; rule: string; description: string; observations: number; basis: string },
): TestScenario {
  const failure = matchingFailure(examples, request);
  const scenario = buildScenario({
    operation,
    category: details.category,
    targetLocation: "body",
    targetField: details.path,
    request,
    assertionResult: failure
      ? { assertions: [{ type: "status-code", expectedStatusCode: failure.responseStatus, basis: "observed" }] }
      : {
          assertions: [],
          gapDescription: "No failure response was observed for this request; the expected outcome is not asserted.",
        },
    rule: details.rule,
    description: details.description,
  });
  return {
    ...scenario,
    evidence: {
      origin: "inferred",
      observationCount: details.observations,
      derivation: "inference-derived",
      summary: details.basis,
    },
  };
}

/** The first applicable reason an operation yielded no scenario, in the contract's order. */
function noteFor(operation: ApiOperation, successStatuses: readonly string[], primary: string | undefined): GenerationNote {
  const observed = operation.observed;
  const base = { operationMethod: operation.method, operationPath: operation.path };
  if (successStatuses.length === 0) {
    return { ...base, reason: "No successful (2xx) response was observed, so no positive scenario can be justified." };
  }
  const successExamples = (observed?.requestExamples ?? []).filter((example) => example.responseStatus.startsWith("2"));
  const withBody = successExamples.filter((example) => example.bodyUnavailable !== undefined);
  if (withBody.length > 0 && withBody.every((example) => example.bodyUnavailable === "multipart-file")) {
    return { ...base, reason: "Every observed request with a body had a multipart file part, which cannot be reproduced." };
  }
  if (withBody.length > 0) {
    return { ...base, reason: `The observed request examples had an unavailable body (${withBody[0].bodyUnavailable}).` };
  }
  return {
    ...base,
    reason: `No observed 2xx example uses the operation's primary request content type (${primary ?? "none"}).`,
  };
}
