import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import type {
  ApiModel,
  ApiOperation,
  EvaluationConditionKind,
  ExpectedBehaviorKind,
  SecurityMutation,
  SecurityScenarioContent,
} from "@apipilot/shared-domain";
import { operationKeyOf } from "../analysis/effectiveSecurity";
import { primaryRequestBodySchema, walkFields } from "../../testDesign/requestHelpers";
import { isCredentialFieldName, isCredentialValue, isPlaceholder } from "./credentialPlaceholders";
import { isProductRuleId } from "./productRules";
import { isGeneratableCategoryId, taxonomyFor } from "../registry/categories";
import { SECURITY_SCENARIO_SCHEMA_V1 } from "./scenarioSchema";
import { parseTarget } from "./requestTarget";
import { violationFor } from "./violations";
import { canonicalJson } from "../canonical";
import { isStateChangingMethod } from "../analysis/sensitivity";

/**
 * The four-step validation every scenario version passes before it is stored (specs/057 FR-020, FR-040,
 * contracts/security-scenario-contract.md "Validation pipeline"), whether a rule generated it, a model suggested it
 * or a person edited it: structure (the draft-07 schema), domain (it refers only to things the specification has),
 * safety (it names no URL, no host, no header of its own choosing and carries no credential) and grounding (its
 * expectation is documented or a named product rule). Every violation is reported with a JSON Pointer and a stable
 * code; nothing partial is kept. Free-form content never becomes a request: only content that passes this does.
 */

export type ScenarioRejectionCode =
  | "schema_violation"
  | "unknown_operation"
  | "unknown_field"
  | "unknown_identity"
  | "category_not_generatable"
  | "mutation_not_supported"
  | "condition_not_allowed"
  | "url_in_content"
  | "header_override_not_allowed"
  | "repeat_over_ceiling"
  | "probe_not_in_set"
  | "ungrounded_expectation"
  | "undocumented_status_cited"
  | "destructive_flag_lowered"
  | "credential_in_content"
  | "constraint_not_declared";

export interface ScenarioViolation {
  readonly pointer: string;
  readonly code: ScenarioRejectionCode;
  readonly message: string;
}

export type ScenarioValidation = { ok: true } | { ok: false; violations: ScenarioViolation[] };

export interface ValidationOptions {
  /** When present the domain checks run; without it only structure, safety and grounding can. */
  readonly apiModel?: ApiModel;
  /** The repeat ceiling in force. Defaults to the schema's own upper bound. */
  readonly maxRepeat?: number;
}

const ALLOWED_CONDITIONS: Readonly<Record<ExpectedBehaviorKind, readonly EvaluationConditionKind[]>> = {
  rejected: ["status.not-success", "status.in-set", "status.equals", "status.not-equals", "header.present", "header.absent", "body.field-absent"],
  allowed: ["status.in-set", "status.equals", "body.field-present", "header.present"],
  limited: ["repeat.limit-engaged", "status.in-set", "status.equals"],
  "no-leak": ["body.not-match-leak-pattern", "body.field-absent", "header.value-not-contains"],
  "header-policy": ["header.present", "header.absent", "header.value-not-contains"],
  "persisted-unchanged": ["persisted.field-unchanged"],
};

const PROBE_FIELD_POINTER = /^\/mutations\/\d+\/(probeId|method)$/;
const PROBE_FIELD_SUFFIX = /\/(probeId|method)$/;

let compiled: ValidateFunction | undefined;
function structureValidator(): ValidateFunction {
  if (!compiled) compiled = new Ajv({ allErrors: true, strict: true }).compile(SECURITY_SCENARIO_SCHEMA_V1);
  return compiled;
}

/**
 * Ajv reports one error per failed alternative of a `oneOf`, which for a mutation or a condition means an error for
 * every kind it is not. They are collapsed to one violation at the item. A probe id or a probe method that is not in
 * the fixed set is the exception: it gets its own code, because that is the mistake a person needs to fix.
 */
function structureViolations(errors: ErrorObject[] | null | undefined): ScenarioViolation[] {
  const all = errors ?? [];
  const oneOfPointers = new Set(all.filter((error) => error.keyword === "oneOf").map((error) => error.instancePath));
  const probeErrors = all.filter(
    (error) => error.keyword === "enum" && PROBE_FIELD_POINTER.test(error.instancePath),
  );
  const probeParents = new Set(probeErrors.map((error) => error.instancePath.replace(PROBE_FIELD_SUFFIX, "")));

  const violations = new Map<string, ScenarioViolation>();
  for (const error of probeErrors) {
    violations.set(error.instancePath, {
      pointer: error.instancePath,
      code: "probe_not_in_set",
      message: `${error.instancePath}: it must be one of the fixed set of benign probes and safe probe methods.`,
    });
  }
  for (const error of all) {
    const pointer = error.instancePath === "" ? "/" : error.instancePath;
    const insideCollapsedItem = [...oneOfPointers].some((parent) => parent !== "" && pointer.startsWith(`${parent}/`));
    if (insideCollapsedItem || probeParents.has(pointer) || violations.has(pointer)) continue;
    const wording = error.keyword === "oneOf" ? "does not match any allowed form" : (error.message ?? "is invalid");
    violations.set(pointer, { pointer, code: "schema_violation", message: `${pointer}: ${wording}.` });
  }
  return [...violations.values()];
}

const URL_SHAPE = /(?:^|[\s"'(<])(?:[a-z][a-z0-9+.-]*:\/\/|\/\/[\w-]+\.|www\.)|\b[\w-]+(?:\.[\w-]+)+:\d{2,5}\b/i;

function looksLikeUrl(text: string): boolean {
  return URL_SHAPE.test(text);
}

/** Every free-text string of the content that must not carry a destination. The base request is exempt: its values are the specification's own examples. */
function textFields(content: SecurityScenarioContent): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ["/title", content.title],
    ["/objective", content.objective],
    ["/rationale", content.rationale],
    ["/impact", content.impact],
    ["/expected/statement", content.expected.statement],
  ];
  if (content.expected.citation) fields.push(["/expected/citation", content.expected.citation]);
  content.limitations.forEach((text, index) => fields.push([`/limitations/${index}`, text]));
  content.manualInputs.forEach((text, index) => fields.push([`/manualInputs/${index}`, text]));
  content.prerequisites.forEach((entry, index) => fields.push([`/prerequisites/${index}/description`, entry.description]));
  content.mutations.forEach((mutation, index) => {
    for (const [name, value] of Object.entries(mutation)) {
      if (typeof value === "string" && name !== "kind") fields.push([`/mutations/${index}/${name}`, value]);
    }
  });
  content.requiredIdentities.forEach((identity, index) => {
    fields.push([`/requiredIdentities/${index}/role`, identity.role], [`/requiredIdentities/${index}/label`, identity.label]);
  });
  return fields;
}

function leaves(value: unknown, name: string, pointer: string, out: Array<{ name: string; value: string; pointer: string }>): void {
  if (typeof value === "string") out.push({ name, value, pointer });
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, name, `${pointer}/${index}`, out));
  else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) leaves(child, key, `${pointer}/${key}`, out);
  }
}

function safetyViolations(content: SecurityScenarioContent, operation: ApiOperation | undefined): ScenarioViolation[] {
  const violations: ScenarioViolation[] = [];

  for (const [pointer, text] of textFields(content)) {
    if (looksLikeUrl(text)) {
      violations.push({ pointer, code: "url_in_content", message: `${pointer}: a scenario may not name a URL or a host; the destination always comes from the profile.` });
    }
  }

  // A header in the base request must be one the specification defines for this operation. Content never invents one.
  if (operation) {
    const allowed = new Set(operation.parameters.filter((parameter) => parameter.location === "header").map((parameter) => parameter.name.toLowerCase()));
    for (const name of Object.keys(content.baseRequest.headers)) {
      if (!allowed.has(name.toLowerCase())) {
        violations.push({ pointer: `/baseRequest/headers/${name}`, code: "header_override_not_allowed", message: `/baseRequest/headers/${name}: a scenario may not add a header the specification does not define for this operation.` });
      }
    }
  }

  // Retained rows survive the session: no credential-shaped value may be stored in a scenario.
  const found: Array<{ name: string; value: string; pointer: string }> = [];
  leaves(content.baseRequest.headers, "headers", "/baseRequest/headers", found);
  leaves(content.baseRequest.queryParameters, "query", "/baseRequest/queryParameters", found);
  leaves(content.baseRequest.pathParameters, "path", "/baseRequest/pathParameters", found);
  if (content.baseRequest.body !== undefined) leaves(content.baseRequest.body, "body", "/baseRequest/body", found);
  for (const leaf of found) {
    if (leaf.value === "" || isPlaceholder(leaf.value)) continue;
    if (isCredentialValue(leaf.value) || isCredentialFieldName(leaf.name)) {
      violations.push({ pointer: leaf.pointer, code: "credential_in_content", message: `${leaf.pointer}: a scenario may not hold a credential; use the placeholder and supply the real value through the profile.` });
    }
  }

  // The flag can be raised by an edit but never lowered below what the operation's method implies.
  const probes = content.mutations.some((mutation) => mutation.kind === "method.probe");
  if (!probes && isStateChangingMethod(content.operationMethod) && !content.destructive.flag) {
    violations.push({ pointer: "/destructive/flag", code: "destructive_flag_lowered", message: `/destructive/flag: ${content.operationMethod} changes state, so the scenario must stay flagged destructive.` });
  }
  return violations;
}

function bodyPathExists(operation: ApiOperation, path: string): boolean {
  const schema = primaryRequestBodySchema(operation);
  if (!schema) return false;
  if (path === "") return true;
  return [...walkFields(schema)].some((field) => field.path === path);
}

function targetSchema(operation: ApiOperation, target: string) {
  const parsed = parseTarget(target);
  if (!parsed) return undefined;
  if (parsed.location === "body") {
    const schema = primaryRequestBodySchema(operation);
    return schema ? [...walkFields(schema)].find((field) => field.path === parsed.name)?.schema : undefined;
  }
  const parameterLocation = parsed.location;
  return operation.parameters.find((parameter) => parameter.location === parameterLocation && parameter.name === parsed.name)?.schema;
}

function mutationDomainViolations(mutation: SecurityMutation, index: number, operation: ApiOperation, maxRepeat: number): ScenarioViolation[] {
  const pointer = `/mutations/${index}`;
  switch (mutation.kind) {
    case "path-id.substitute":
      return operation.parameters.some((parameter) => parameter.location === "path" && parameter.name === mutation.parameter)
        ? []
        : [{ pointer: `${pointer}/parameter`, code: "unknown_field", message: `${pointer}/parameter: "${mutation.parameter}" is not a path parameter of the operation.` }];
    case "body.add-property":
      return bodyPathExists(operation, mutation.path)
        ? []
        : [{ pointer: `${pointer}/path`, code: "unknown_field", message: `${pointer}/path: the operation's request body has no object at "${mutation.path}".` }];
    case "field.violate-constraint": {
      const schema = targetSchema(operation, mutation.path);
      if (!schema) return [{ pointer: `${pointer}/path`, code: "unknown_field", message: `${pointer}/path: "${mutation.path}" is not an input of the operation.` }];
      return violationFor(schema, mutation.constraint)
        ? []
        : [{ pointer: `${pointer}/constraint`, code: "constraint_not_declared", message: `${pointer}/constraint: the specification does not declare ${mutation.constraint} for "${mutation.path}".` }];
    }
    case "input.injection-probe": {
      const parsed = parseTarget(mutation.path);
      return parsed?.location === "query" && targetSchema(operation, mutation.path)
        ? []
        : [{ pointer: `${pointer}/path`, code: "unknown_field", message: `${pointer}/path: an injection probe targets a query parameter of the operation.` }];
    }
    case "request.repeat":
      return mutation.count <= maxRepeat ? [] : [{ pointer: `${pointer}/count`, code: "repeat_over_ceiling", message: `${pointer}/count: ${mutation.count} is above the repeat ceiling of ${maxRepeat}.` }];
    default:
      return [];
  }
}

function domainViolations(content: SecurityScenarioContent, apiModel: ApiModel, maxRepeat: number): { violations: ScenarioViolation[]; operation?: ApiOperation } {
  const violations: ScenarioViolation[] = [];
  const operation = apiModel.operations.find((candidate) => operationKeyOf(candidate) === content.operationKey);
  if (!operation) {
    return { violations: [{ pointer: "/operationKey", code: "unknown_operation", message: `/operationKey: "${content.operationKey}" is not an operation of the loaded specification.` }] };
  }
  if (content.operationKey !== `${content.operationMethod} ${content.operationPath}`) {
    violations.push({ pointer: "/operationKey", code: "unknown_operation", message: "/operationKey: it must equal the method and path of the scenario." });
  }

  if (!isGeneratableCategoryId(content.categoryId)) {
    violations.push({ pointer: "/categoryId", code: "category_not_generatable", message: `/categoryId: "${content.categoryId}" cannot have scenarios generated.` });
  } else if (canonicalJson(taxonomyFor(content.categoryId)) !== canonicalJson(content.taxonomy)) {
    violations.push({ pointer: "/taxonomy", code: "schema_violation", message: "/taxonomy: it must match the registry's mapping for the category." });
  }

  content.mutations.forEach((mutation, index) => violations.push(...mutationDomainViolations(mutation, index, operation, maxRepeat)));

  const documented = new Set(operation.responses.map((response) => Number(response.statusCode)));
  for (const code of content.expected.documentedStatusCodes ?? []) {
    if (!documented.has(code)) {
      violations.push({ pointer: "/expected/documentedStatusCodes", code: "undocumented_status_cited", message: `/expected/documentedStatusCodes: the operation does not document ${code}.` });
    }
  }
  return { violations, operation };
}

function groundingViolations(content: SecurityScenarioContent): ScenarioViolation[] {
  const violations: ScenarioViolation[] = [];
  const { expected } = content;
  if (expected.basis === "documented" && !(expected.documentedStatusCodes?.length || expected.citation)) {
    violations.push({ pointer: "/expected", code: "ungrounded_expectation", message: "/expected: a documented expectation must cite a documented status or a specification element." });
  }
  if (expected.basis === "product-rule" && !(expected.ruleId && isProductRuleId(expected.ruleId))) {
    violations.push({ pointer: "/expected/ruleId", code: "ungrounded_expectation", message: "/expected/ruleId: a product-rule expectation must name a known rule." });
  }
  const allowed = ALLOWED_CONDITIONS[expected.kind];
  content.conditions.forEach((condition, index) => {
    if (!allowed.includes(condition.kind)) {
      violations.push({ pointer: `/conditions/${index}`, code: "condition_not_allowed", message: `/conditions/${index}: ${condition.kind} cannot judge an expectation of kind "${expected.kind}".` });
    }
  });

  const repeat = content.mutations.find((mutation) => mutation.kind === "request.repeat");
  const planned = repeat?.kind === "request.repeat" ? repeat.count : 1;
  if (content.plannedRequestCount !== planned) {
    violations.push({ pointer: "/plannedRequestCount", code: "schema_violation", message: `/plannedRequestCount: it must equal ${planned}, the number of requests the mutations send.` });
  }
  return violations;
}

/**
 * Validates scenario content. `content` is `unknown` on purpose: this is the boundary where untrusted input (a
 * person's edit, a model's suggestion) meets the typed model, and nothing is trusted until the structure passes.
 */
export function validateScenario(content: unknown, options: ValidationOptions = {}): ScenarioValidation {
  const validate = structureValidator();
  if (!validate(content)) {
    return { ok: false, violations: structureViolations(validate.errors) };
  }
  const typed = content as SecurityScenarioContent;
  const violations: ScenarioViolation[] = [];

  let operation: ApiOperation | undefined;
  if (options.apiModel) {
    const domain = domainViolations(typed, options.apiModel, options.maxRepeat ?? 50);
    violations.push(...domain.violations);
    operation = domain.operation;
  }
  violations.push(...safetyViolations(typed, operation), ...groundingViolations(typed));

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
