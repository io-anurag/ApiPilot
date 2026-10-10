import type {
  AnalysisIssue,
  ApiModel,
  ApiOperation,
  CoverageCategoryGroup,
  CoverageNotMeasurable,
  CoverageRequirement,
  CoverageRequirementGroup,
  SchemaConstraint,
} from "@apipilot/shared-domain";
import { toOperationKey } from "@apipilot/shared-domain";
import { primaryRequestBodySchema, walkFields } from "../testDesign/requestHelpers";
import { arrayBoundaryValues, numericBoundaryValues, stringBoundaryValues } from "../testDesign/valueGenerators";
import { fragmentHash, stableStringify } from "./specRevision";

type GroupName = Exclude<CoverageCategoryGroup, "security">;

/** The fields of one operation a scenario can target, keyed `"<location>:<name or dotted path>"`. */
export interface FieldRef {
  location: "path" | "query" | "header" | "body";
  name: string;
  /** Id of the field's "exercised" element; every case id of the field is `${fieldId}#<case>`. */
  fieldId: string;
}

/** An enum value element, kept so a scenario's actual request value can be matched to it. */
export interface EnumElement {
  id: string;
  fieldId: string;
  value: unknown;
}

/** A boundary value element; covered when a qualifying scenario's request carries exactly this value. */
export interface BoundaryElement {
  id: string;
  fieldId: string;
  value: unknown;
}

/** Everything coverage measures for one operation, plus what is deliberately not measured. */
export interface OperationElements {
  operationKey: string;
  operation: ApiOperation;
  requirements: CoverageRequirement[];
  ids: Set<string>;
  fields: Map<string, FieldRef>;
  fieldsById: Map<string, FieldRef>;
  enumElements: EnumElement[];
  boundaryElements: BoundaryElement[];
  notMeasurable: CoverageNotMeasurable[];
  /** Groups for which this operation has at least one requirement. */
  groups: Set<GroupName>;
}

export const opId = (key: string): string => `op:${key}`;
export const respId = (key: string, code: string): string => `resp:${key}:${code}`;
export const respSchemaId = (key: string, code: string): string => `respschema:${key}:${code}`;

/**
 * The category group of a documented response key (coverage-rules.md 4.3). Only an exact `2xx` or
 * `4xx` is classified: `default`, ranges such as `2XX`, `3xx` and `5xx` cannot be provoked
 * deterministically by any generator and stay in their own metric but in no category denominator.
 */
export function responseGroup(statusCode: string): CoverageRequirementGroup {
  if (/^2\d\d$/.test(statusCode)) return "positive";
  if (/^4\d\d$/.test(statusCode)) return "negative";
  return "unclassified";
}

const pointerSegment = (value: string): string => value.replaceAll("~", "~0").replaceAll("/", "~1");
const operationPointer = (operation: ApiOperation): string => `#/paths/${pointerSegment(operation.path)}/${operation.method.toLowerCase()}`;

/** JSON-pointer style location of a body property, from the dotted path the walker produces (`items[].qty`). */
function bodyPointer(base: string, media: string, path: string): string {
  const segments = path.split(".").map((segment) => {
    const isArray = segment.endsWith("[]");
    const name = isArray ? segment.slice(0, -2) : segment;
    return `properties/${pointerSegment(name)}${isArray ? "/items" : ""}`;
  });
  return `${base}/requestBody/content/${pointerSegment(media)}/schema/${segments.join("/")}`;
}
export const fieldKey = (location: FieldRef["location"], name: string): string => `${location}:${name}`;

const BOUNDARY_SIDES = {
  numeric: {
    prefix: "numeric-boundary",
    sides: [
      ["belowMinimum", "below-minimum", "below the minimum"],
      ["atMinimum", "at-minimum", "at the minimum"],
      ["atMaximum", "at-maximum", "at the maximum"],
      ["aboveMaximum", "above-maximum", "above the maximum"],
    ],
  },
  string: {
    prefix: "string-boundary",
    sides: [
      ["belowMinLength", "below-minimum", "below the minimum length"],
      ["atMinLength", "at-minimum", "at the minimum length"],
      ["atMaxLength", "at-maximum", "at the maximum length"],
      ["aboveMaxLength", "above-maximum", "above the maximum length"],
    ],
  },
  array: {
    prefix: "array-boundary",
    sides: [
      ["belowMinItems", "below-minimum", "below the minimum item count"],
      ["atMinItems", "at-minimum", "at the minimum item count"],
      ["atMaxItems", "at-maximum", "at the maximum item count"],
      ["aboveMaxItems", "above-maximum", "above the maximum item count"],
    ],
  },
} as const;

/** True when the schema's array items carry constraints no generation rule exercises individually. */
function hasItemConstraints(schema: SchemaConstraint): boolean {
  const items = schema.items;
  if (!items) return false;
  return (
    Object.keys(items.properties).length > 0 ||
    (items.enum?.length ?? 0) > 0 ||
    items.minimum !== undefined ||
    items.maximum !== undefined ||
    items.minLength !== undefined ||
    items.maxLength !== undefined ||
    items.format !== undefined ||
    items.pattern !== undefined
  );
}

/**
 * Builds the measurable requirements for one operation (specs/046 research R6/R7). A requirement
 * exists only where a generated scenario could in principle exercise the element; anything the
 * scenario model cannot express (cookie parameters, array item schemas, secondary media types) is
 * returned as not measurable, with its reason, instead of being counted or silently dropped.
 */
export function extractOperationElements(operation: ApiOperation): OperationElements {
  const operationKey = toOperationKey(operation);
  const requirements: CoverageRequirement[] = [];
  const notMeasurable: CoverageNotMeasurable[] = [];
  const fields = new Map<string, FieldRef>();
  const enumElements: EnumElement[] = [];
  const boundaryElements: BoundaryElement[] = [];
  const groups = new Set<GroupName>(["positive"]);
  const opPointer = operationPointer(operation);

  const add = (requirement: CoverageRequirement): void => {
    requirements.push(requirement);
    if (requirement.group !== "unclassified") groups.add(requirement.group);
  };

  add({
    id: opId(operationKey),
    kind: "operation",
    operationKey,
    label: operationKey,
    contractHash: fragmentHash({ method: operation.method, path: operation.path }),
    group: "positive",
    source: opPointer,
  });

  /** Adds the per-constraint case requirements of one field. */
  const addCases = (
    fieldId: string,
    label: string,
    schema: SchemaConstraint,
    required: boolean,
    kind: "parameter-case" | "request-schema",
    source: string,
  ): void => {
    const base = { kind, operationKey, source } as const;
    if (required) {
      add({
        ...base,
        id: `${fieldId}#required`,
        label: `${label}: required, omitted`,
        contractHash: fragmentHash({ fieldId, required: true }),
        group: "negative",
      });
    }
    if (schema.type) {
      add({
        ...base,
        id: `${fieldId}#type`,
        label: `${label}: incompatible type`,
        contractHash: fragmentHash({ fieldId, type: schema.type }),
        group: "negative",
      });
    }
    for (const value of schema.enum ?? []) {
      const id = `${fieldId}#enum:${stableStringify(value)}`;
      enumElements.push({ id, fieldId, value });
      add({
        ...base,
        id,
        label: `${label}: enum value ${JSON.stringify(value)}`,
        contractHash: fragmentHash({ fieldId, value }),
        group: "positive",
      });
    }
    if ((schema.enum?.length ?? 0) > 0) {
      add({
        ...base,
        id: `${fieldId}#enum-invalid`,
        label: `${label}: value outside the enum`,
        contractHash: fragmentHash({ fieldId, enum: schema.enum }),
        group: "negative",
      });
    }
    if (schema.format || schema.pattern) {
      add({
        ...base,
        id: `${fieldId}#format`,
        label: `${label}: violates ${schema.format ? `format ${schema.format}` : "its pattern"}`,
        contractHash: fragmentHash({ fieldId, format: schema.format, pattern: schema.pattern }),
        group: "negative",
      });
    }
    const boundaryKinds: [keyof typeof BOUNDARY_SIDES, Record<string, unknown>][] = [
      ["numeric", numericBoundaryValues(schema) as unknown as Record<string, unknown>],
      ["string", stringBoundaryValues(schema) as unknown as Record<string, unknown>],
      ["array", arrayBoundaryValues(schema) as unknown as Record<string, unknown>],
    ];
    for (const [family, values] of boundaryKinds) {
      const { prefix, sides } = BOUNDARY_SIDES[family];
      for (const [valueKey, ruleKey, phrase] of sides) {
        if (values[valueKey] === undefined) continue;
        const id = `${fieldId}#boundary:${prefix}-${ruleKey}`;
        boundaryElements.push({ id, fieldId, value: values[valueKey] });
        add({
          ...base,
          id,
          label: `${label}: ${phrase}`,
          contractHash: fragmentHash({ fieldId, family, ruleKey, schema: [schema.minimum, schema.maximum, schema.minLength, schema.maxLength, schema.minItems, schema.maxItems] }),
          group: "boundary",
        });
      }
    }
  };

  for (const parameter of operation.parameters) {
    const label = `${parameter.location} parameter "${parameter.name}"`;
    if (parameter.location === "cookie") {
      notMeasurable.push({
        kind: "parameter",
        operationKey,
        label,
        reason: "The scenario model cannot carry cookie parameters, so no generated scenario can exercise them.",
      });
      continue;
    }
    const fieldId = `param:${operationKey}:${parameter.location}:${parameter.name}`;
    fields.set(fieldKey(parameter.location, parameter.name), {
      location: parameter.location,
      name: parameter.name,
      fieldId,
    });
    const parameterSource = `${opPointer}/parameters/${pointerSegment(parameter.name)}`;
    add({
      id: fieldId,
      kind: "parameter",
      operationKey,
      source: parameterSource,
      label,
      contractHash: fragmentHash({ name: parameter.name, location: parameter.location, required: parameter.required, schema: parameter.schema }),
      group: "positive",
    });
    // A path parameter cannot be omitted, so "required, omitted" is not a case for it.
    addCases(fieldId, label, parameter.schema, parameter.required && parameter.location !== "path", "parameter-case", parameterSource);
    if (hasItemConstraints(parameter.schema)) {
      notMeasurable.push({
        kind: "parameter-case",
        operationKey,
        label,
        reason: "Array item constraints are not exercised individually by any generation rule.",
      });
    }
  }

  const bodySchema = primaryRequestBodySchema(operation);
  const mediaTypes = Object.keys(operation.requestBody?.contentTypes ?? {});
  const primaryMedia = mediaTypes.includes("application/json") ? "application/json" : (mediaTypes[0] ?? "application/json");
  if (operation.requestBody && Object.keys(operation.requestBody.contentTypes).length > 1) {
    notMeasurable.push({
      kind: "request-schema",
      operationKey,
      label: `${operationKey} request body`,
      reason: "Only the primary media type (application/json when declared) is exercised; other declared media types are not measured.",
    });
  }
  if (bodySchema) {
    for (const field of walkFields(bodySchema)) {
      const fieldId = `reqprop:${operationKey}:${field.path}`;
      const label = `body field "${field.path}"`;
      const fieldSource = bodyPointer(opPointer, primaryMedia, field.path);
      fields.set(fieldKey("body", field.path), { location: "body", name: field.path, fieldId });
      add({
        id: fieldId,
        kind: "request-schema",
        operationKey,
        source: fieldSource,
        label,
        contractHash: fragmentHash({ path: field.path, required: field.required, schema: field.schema }),
        group: "positive",
      });
      addCases(fieldId, label, field.schema, field.required, "request-schema", fieldSource);
      if (hasItemConstraints(field.schema)) {
        notMeasurable.push({
          kind: "request-schema",
          operationKey,
          label,
          reason: "Array item constraints are not exercised individually by any generation rule.",
        });
      }
    }
  }

  for (const response of operation.responses) {
    add({
      id: respId(operationKey, response.statusCode),
      kind: "response-code",
      operationKey,
      label: `documented response ${response.statusCode}`,
      contractHash: fragmentHash({ statusCode: response.statusCode, description: response.description }),
      group: responseGroup(response.statusCode),
      source: `${opPointer}/responses/${pointerSegment(response.statusCode)}`,
    });
    if (Object.keys(response.contentTypes).length > 0) {
      add({
        id: respSchemaId(operationKey, response.statusCode),
        kind: "response-schema",
        operationKey,
        label: `response ${response.statusCode} schema`,
        contractHash: fragmentHash({ statusCode: response.statusCode, contentTypes: response.contentTypes }),
        group: responseGroup(response.statusCode),
        source: `${opPointer}/responses/${pointerSegment(response.statusCode)}/content`,
      });
    }
  }

  return {
    operationKey,
    operation,
    requirements,
    ids: new Set(requirements.map((r) => r.id)),
    fields,
    fieldsById: new Map([...fields.values()].map((f) => [f.fieldId, f])),
    enumElements,
    boundaryElements,
    notMeasurable,
    groups,
  };
}

/** `"#/paths/<path>/<method>/..."` -> `"METHOD <path>"`, or `undefined` for a document-level location. */
export function operationKeyOfLocation(location: string): string | undefined {
  const match = /^#\/paths\/(.+?)\/(get|put|post|delete|options|head|patch|trace)(\/|$)/.exec(location);
  return match ? `${match[2].toUpperCase()} ${match[1]}` : undefined;
}

/**
 * Specification constructs the model could not keep or resolve, as not-measurable entries. Issues
 * attributable to an out-of-scope operation are dropped; document-level ones are kept.
 * `composed-schema` and `duplicate-operation` are informational and not coverage limits.
 */
export function notMeasurableFromIssues(apiModel: ApiModel, inScope: ReadonlySet<string>): CoverageNotMeasurable[] {
  const entries: CoverageNotMeasurable[] = [];
  const relevant = (issue: AnalysisIssue): boolean =>
    issue.kind === "unsupported-construct" || issue.kind === "unresolved-ref" || issue.kind === "circular-ref";
  for (const issue of apiModel.summary.issues.filter(relevant)) {
    const operationKey = operationKeyOfLocation(issue.location);
    if (operationKey !== undefined && !inScope.has(operationKey)) continue;
    entries.push({
      kind: "construct",
      ...(operationKey !== undefined ? { operationKey } : {}),
      label: issue.kind,
      location: issue.location,
      reason: issue.message,
    });
  }
  return entries;
}
