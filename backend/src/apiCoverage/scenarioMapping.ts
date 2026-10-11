import type { CoverageCategoryGroup, CoverageCheckScope, GeneratedRequest, TestScenario } from "@apipilot/shared-domain";
import { toOperationKey } from "@apipilot/shared-domain";
import { fieldKey, opId, respId, respSchemaId, type FieldRef, type OperationElements } from "./elements";
import { stableStringify } from "./specRevision";

type GroupName = Exclude<CoverageCategoryGroup, "security">;

/**
 * One requirement a scenario contributes to, and which of its checks decide verification of it
 * (coverage-rules.md 5.2): `status` for exercised and case requirements, `status-code` for one
 * documented response, `schema-conformance` for a response schema. A schema check never decides
 * whether a request was accepted, so a failing schema check fails only the schema requirement.
 */
export interface ScenarioMapping {
  requirementId: string;
  scope: CoverageCheckScope;
  /** Present for `scope: "status-code"`: only the assertion expecting this code counts. */
  responseCode?: string;
}

const POSITIVE_BASE_RULES = new Set(["positive-scenario", "minimal-positive-scenario"]);

/** AI scenarios carry no rule id; their category is the closest equivalent where one exists. */
const AI_CATEGORY_RULE: Partial<Record<TestScenario["category"], string>> = {
  "missing-field": "required-field-missing",
  "null-value": "required-field-null",
  "empty-value": "required-field-empty",
  "invalid-type": "invalid-type",
  "invalid-format": "invalid-format",
  "invalid-enum": "invalid-enum",
};

/** The rule id a scenario's mapping is keyed on; `undefined` when no specific element can be inferred. */
export function ruleKeyOf(scenario: TestScenario): string | undefined {
  return scenario.provenance.source === "RULE" ? scenario.provenance.rule : AI_CATEGORY_RULE[scenario.category];
}

/**
 * The category group a scenario belongs to. Derived from the rule id, not the `category` field:
 * an at-boundary variant is schema-conformant and carries category `positive`, yet it is a
 * boundary case (specs/046 research R8). Each scenario belongs to exactly one group.
 */
export function scenarioGroup(scenario: TestScenario): GroupName {
  const rule = scenario.provenance.source === "RULE" ? scenario.provenance.rule : undefined;
  if (rule !== undefined) {
    if (rule.includes("-boundary-")) return "boundary";
    if (rule.startsWith("required-field-") || rule.startsWith("invalid-")) return "negative";
    return "positive";
  }
  switch (scenario.category) {
    case "positive":
      return "positive";
    case "numeric-boundary":
    case "string-boundary":
    case "array-boundary":
      return "boundary";
    default:
      return "negative";
  }
}

function valueAt(request: GeneratedRequest, field: FieldRef): unknown {
  if (field.location === "path") return request.pathParameters[field.name];
  if (field.location === "query") return request.queryParameters[field.name];
  if (field.location === "header") return request.headers[field.name];
  let cursor: unknown = request.body;
  for (const segment of field.name.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Maps one scenario to the requirements of its operation it can honestly be said to exercise.
 * A requirement is mapped only when the relationship follows from the scenario's recorded rule,
 * target and assertions; a scenario whose target cannot be determined contributes nothing at
 * requirement level (FR-003) and is still counted for operation-level coverage by the caller.
 *
 * Crediting (coverage-rules.md 4.4): the `operation` happy path and "exercised" requirements are
 * credited only by positive-group scenarios, so a negative or boundary scenario never proves the
 * normal path works. Response codes and schemas are credited by any scenario asserting them.
 * Deterministic: output is sorted and deduplicated.
 */
export function mapScenario(elements: OperationElements, scenario: TestScenario): ScenarioMapping[] {
  const key = toOperationKey({ method: scenario.operationMethod, path: scenario.operationPath });
  const mappings = new Map<string, ScenarioMapping>();
  const add = (requirementId: string, scope: CoverageCheckScope = "status", responseCode?: string): void => {
    if (!elements.ids.has(requirementId)) return;
    mappings.set(`${requirementId}|${scope}|${responseCode ?? ""}`, {
      requirementId,
      scope,
      ...(responseCode !== undefined ? { responseCode } : {}),
    });
  };

  const rule = ruleKeyOf(scenario);
  const group = scenarioGroup(scenario);
  if (group === "positive") add(opId(key));
  const target =
    scenario.targetLocation !== undefined && scenario.targetField !== undefined
      ? elements.fields.get(fieldKey(scenario.targetLocation, scenario.targetField))
      : undefined;

  // "Exercised": the valid base requests exercise every field they carry; a positive scenario
  // aimed at one field (enum variant, at-boundary value) exercises that field.
  if (rule !== undefined && POSITIVE_BASE_RULES.has(rule)) {
    for (const field of elements.fields.values()) {
      if (valueAt(scenario.request, field) !== undefined) add(field.fieldId);
    }
    for (const element of elements.enumElements) {
      const field = elements.fieldsById.get(element.fieldId);
      if (field && stableStringify(valueAt(scenario.request, field)) === stableStringify(element.value)) {
        add(element.id);
      }
    }
  } else if (target && group === "positive") {
    add(target.fieldId);
  }

  if (target && rule !== undefined) {
    const fid = target.fieldId;
    if (rule === "required-field-missing") add(`${fid}#required`);
    else if (rule === "invalid-type") add(`${fid}#type`);
    else if (rule === "invalid-enum") add(`${fid}#enum-invalid`);
    else if (rule === "invalid-format") add(`${fid}#format`);
    else if (rule === "enum-positive-variant") {
      const value = stableStringify(valueAt(scenario.request, target));
      for (const element of elements.enumElements) {
        if (element.fieldId === fid && stableStringify(element.value) === value) add(element.id);
      }
    }
  }

  // Boundary values: a base positive scenario or a scenario aimed at the field covers a boundary
  // element when its request carries exactly the boundary value. Matching on the value, not the
  // rule name, keeps coverage correct when the designer deduplicated an at-boundary scenario into
  // the baseline one (its value is the same), and applies to AI scenarios too.
  for (const element of elements.boundaryElements) {
    const field = elements.fieldsById.get(element.fieldId);
    if (!field) continue;
    const eligible = (rule !== undefined && POSITIVE_BASE_RULES.has(rule)) || target?.fieldId === element.fieldId;
    if (eligible && stableStringify(valueAt(scenario.request, field)) === stableStringify(element.value)) add(element.id);
  }

  const statusAssertions = scenario.assertions.filter((a) => a.type === "status-code" && a.expectedStatusCode !== undefined);
  for (const assertion of statusAssertions) add(respId(key, assertion.expectedStatusCode as string), "status-code", assertion.expectedStatusCode);
  const firstCode = statusAssertions[0]?.expectedStatusCode;
  if (firstCode !== undefined && scenario.assertions.some((a) => a.type === "schema-conformance")) {
    add(respSchemaId(key, firstCode), "schema-conformance");
  }

  return [...mappings.values()].sort((a, b) =>
    `${a.requirementId}|${a.scope}|${a.responseCode ?? ""}`.localeCompare(`${b.requirementId}|${b.scope}|${b.responseCode ?? ""}`),
  );
}
