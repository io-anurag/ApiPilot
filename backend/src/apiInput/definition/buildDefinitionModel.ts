import type {
  AnalysisIssue,
  ApiModel,
  ApiOperation,
  DependencyHint,
  Parameter,
  RequestBody,
  Response,
  SchemaConstraint,
  SecurityRequirement,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";
import { nullProtoRecord, toPlainRecord } from "../jsonSafe";
import {
  CredentialCollector,
  classifyHeader,
  redactHeaderValue,
  redactJsonValue,
  redactNamedValue,
} from "../redaction";
import { isEmptyConstraint } from "../../testDesign/rules/declaredExampleScenarios";
import { formatRedactionPlaceholder } from "../../testDesign/sensitiveValueDetection";
import type {
  ApiDefinitionV1,
  DefinitionAuthScheme,
  DefinitionExample,
  DefinitionHint,
  DefinitionOperation,
  DefinitionParameter,
  DefinitionSchema,
} from "./types";

/**
 * Maps a validated API definition onto the existing `ApiModel` (specs/056 FR-023, FR-025, FR-026,
 * data-model.md "Definition-format mapping"). Every fact it creates is `declared`. Whatever the
 * definition does not state stays unknown: a parameter without `required` carries `requiredUnknown`,
 * an operation without `responses` documents no status, and a missing schema is an empty constraint,
 * never a guessed one. Credential values found in examples are replaced by placeholders before they
 * enter the model and are reported as a `credential-detected` issue, without any value.
 *
 * Pure: the model depends only on the definition, never on the clock, randomness or the machine.
 */

const DECLARED = { origin: "declared" } as const;

function emptyConstraint(): SchemaConstraint {
  return { required: [], properties: {} };
}

/** The definition's closed schema vocabulary as the model's constraint, carrying only what was written. */
function toConstraint(schema: DefinitionSchema | undefined): SchemaConstraint {
  if (!schema) return emptyConstraint();
  const properties: Record<string, SchemaConstraint> = {};
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    Object.defineProperty(properties, name, { value: toConstraint(child), enumerable: true, writable: true, configurable: true });
  }
  const constraint: SchemaConstraint = { required: [...(schema.required ?? [])], properties };
  if (schema.type !== undefined) constraint.type = schema.type;
  if (schema.items !== undefined) constraint.items = toConstraint(schema.items);
  if (schema.enum !== undefined) constraint.enum = [...schema.enum];
  if (schema.format !== undefined) constraint.format = schema.format;
  if (schema.minimum !== undefined) constraint.minimum = schema.minimum;
  if (schema.maximum !== undefined) constraint.maximum = schema.maximum;
  if (schema.pattern !== undefined) constraint.pattern = schema.pattern;
  if (schema.minLength !== undefined) constraint.minLength = schema.minLength;
  if (schema.maxLength !== undefined) constraint.maxLength = schema.maxLength;
  if (schema.minItems !== undefined) constraint.minItems = schema.minItems;
  if (schema.maxItems !== undefined) constraint.maxItems = schema.maxItems;
  return constraint;
}

function countSchemas(constraint: SchemaConstraint): number {
  let count = 1;
  for (const child of Object.values(constraint.properties)) count += countSchemas(child);
  if (constraint.items) count += countSchemas(constraint.items);
  return count;
}

function toSecurityScheme(scheme: DefinitionAuthScheme): SecuritySchemeDefinition {
  switch (scheme.type) {
    case "http-bearer":
      return { type: "http", scheme: "bearer" };
    case "http-basic":
      return { type: "http", scheme: "basic" };
    case "api-key":
      return { type: "apiKey", in: scheme.in, name: scheme.parameterName };
    case "oauth2-client-credentials":
      return {
        type: "oauth2",
        flows: { clientCredentials: { tokenUrl: scheme.tokenUrl ?? "", scopes: [...(scheme.scopes ?? [])] } },
      };
  }
}

/** Examples keyed by their name, or `example1`, `example2` when unnamed; credential values already replaced. */
function redactExamples(
  examples: readonly DefinitionExample[] | undefined,
  collector: CredentialCollector,
): Record<string, unknown> {
  const keyed = nullProtoRecord<unknown>();
  (examples ?? []).forEach((example, index) => {
    const base = example.name ?? `example${index + 1}`;
    let key = base;
    for (let suffix = 2; key in keyed; suffix += 1) key = `${base}-${suffix}`;
    keyed[key] = redactJsonValue(example.value, collector, "body");
  });
  return toPlainRecord(keyed);
}

/** A declared parameter example with any credential replaced by its placeholder. */
function redactParameterExample(parameter: DefinitionParameter, collector: CredentialCollector): unknown {
  const value = parameter.example;
  if (value === undefined) return undefined;
  if (parameter.in === "header") {
    if (typeof value === "string") return redactHeaderValue(parameter.name, value, collector);
    const kind = classifyHeader(parameter.name, "");
    if (kind === undefined) return value;
    collector.record("header", parameter.name.toLowerCase(), kind);
    return formatRedactionPlaceholder(kind);
  }
  return redactNamedValue(parameter.in, parameter.name, value, collector);
}

function toParameter(parameter: DefinitionParameter, collector: CredentialCollector): Parameter {
  const isPath = parameter.in === "path";
  const example = redactParameterExample(parameter, collector);
  return {
    name: parameter.name,
    location: parameter.in,
    required: isPath ? true : parameter.required === true,
    schema: toConstraint(parameter.schema),
    provenance: DECLARED,
    ...(!isPath && parameter.required === undefined ? { requiredUnknown: true as const } : {}),
    ...(example !== undefined ? { example } : {}),
  };
}

function toRequestBody(operation: DefinitionOperation, collector: CredentialCollector): RequestBody | undefined {
  const body = operation.requestBody;
  if (!body) return undefined;
  const examples = redactExamples(body.examples, collector);
  return {
    required: body.required === true,
    contentTypes: toPlainRecord({ [body.contentType]: toConstraint(body.schema) }),
    provenance: DECLARED,
    ...(body.required === undefined ? { requiredUnknown: true as const } : {}),
    ...(Object.keys(examples).length > 0 ? { examples } : {}),
  };
}

function toResponses(operation: DefinitionOperation, collector: CredentialCollector): Response[] {
  return (operation.responses ?? []).map((response) => ({
    statusCode: String(response.status),
    description: response.description ?? "",
    contentTypes: response.contentType === undefined ? {} : toPlainRecord({ [response.contentType]: toConstraint(response.schema) }),
    examples: redactExamples(response.examples, collector),
    provenance: DECLARED,
  }));
}

/** Each named scheme is an alternative (OR), the same shape an OpenAPI list of single-scheme requirements has. */
function toSecurity(operation: DefinitionOperation): SecurityRequirement[] {
  return (operation.security ?? []).map((name) => ({ schemes: [{ name, scopes: [] }] }));
}

// ---- Dependency hints ----------------------------------------------------------------------

function constraintHasField(constraint: SchemaConstraint | undefined, path: string): boolean {
  if (!constraint) return false;
  let cursor: SchemaConstraint | undefined = constraint;
  for (const rawSegment of path.split(".")) {
    if (!cursor) return false;
    let segment = rawSegment;
    const intoItems = segment.endsWith("[]");
    if (intoItems) segment = segment.slice(0, -2);
    if (segment !== "") {
      const next: SchemaConstraint | undefined = Object.hasOwn(cursor.properties, segment) ? cursor.properties[segment] : undefined;
      if (!next) return false;
      cursor = next;
    }
    if (intoItems) {
      if (!cursor.items) return false;
      cursor = cursor.items;
    }
  }
  return true;
}

function producerDeclaresField(operation: ApiOperation, field: string): boolean {
  return operation.responses
    .filter((response) => response.statusCode.startsWith("2"))
    .some((response) => Object.values(response.contentTypes).some((schema) => constraintHasField(schema, field)));
}

function consumerDeclaresField(operation: ApiOperation, hint: DefinitionHint["consumer"]): boolean {
  if (hint.location === "body") {
    return Object.values(operation.requestBody?.contentTypes ?? {}).some((schema) => constraintHasField(schema, hint.field));
  }
  return operation.parameters.some(
    (parameter) =>
      parameter.location === hint.location &&
      (hint.location === "header" ? parameter.name.toLowerCase() === hint.field.toLowerCase() : parameter.name === hint.field) &&
      !isEmptyConstraint(parameter.schema),
  );
}

function toHints(definition: ApiDefinitionV1, operations: readonly ApiOperation[]): DependencyHint[] {
  const byReference = new Map<string, ApiOperation>();
  definition.operations.forEach((declared, index) => {
    const built = operations[index];
    byReference.set(`${declared.method} ${declared.path}`, built);
    if (declared.id !== undefined) byReference.set(declared.id, built);
  });
  const hints: DependencyHint[] = [];
  for (const hint of definition.dependencyHints ?? []) {
    const producer = byReference.get(hint.producer.operation);
    const consumer = byReference.get(hint.consumer.operation);
    if (!producer || !consumer) continue; // Validation already rejected an unknown target; defensive only.
    hints.push({
      origin: "declared",
      producer: { operationMethod: producer.method, operationPath: producer.path, field: hint.producer.field },
      consumer: {
        operationMethod: consumer.method,
        operationPath: consumer.path,
        field: hint.consumer.field,
        location: hint.consumer.location,
      },
      verified: producerDeclaresField(producer, hint.producer.field) && consumerDeclaresField(consumer, hint.consumer),
    });
  }
  return hints;
}

// ---- The model -----------------------------------------------------------------------------

function describeCredentials(collector: CredentialCollector): string {
  return [...new Set(collector.list().map((credential) => `${credential.kind} in ${credential.location}`))].join(", ");
}

export function buildDefinitionModel(definition: ApiDefinitionV1): ApiModel {
  const issues: AnalysisIssue[] = [];
  let schemaCount = 0;

  const operations: ApiOperation[] = definition.operations.map((declared) => {
    const collector = new CredentialCollector();
    const parameters = (declared.parameters ?? []).map((parameter) => toParameter(parameter, collector));
    const requestBody = toRequestBody(declared, collector);
    const responses = toResponses(declared, collector);

    for (const parameter of parameters) schemaCount += countSchemas(parameter.schema);
    for (const schema of Object.values(requestBody?.contentTypes ?? {})) schemaCount += countSchemas(schema);
    for (const response of responses) for (const schema of Object.values(response.contentTypes)) schemaCount += countSchemas(schema);

    if (collector.list().length > 0) {
      issues.push({
        kind: "credential-detected",
        location: `${declared.method} ${declared.path}`,
        message: `Credentials were declared in examples (${describeCredentials(collector)}) and replaced with placeholders; no value was kept. Supply real values through an environment when you run the tests.`,
      });
    }

    return {
      path: declared.path,
      method: declared.method,
      operationId: declared.id,
      provenance: DECLARED,
      ...(declared.description !== undefined ? { description: declared.description } : {}),
      parameters,
      requestBody,
      responses,
      security: toSecurity(declared),
      tags: [...(declared.tags ?? [])],
    };
  });

  const securitySchemes: Record<string, SecuritySchemeDefinition> = {};
  for (const scheme of definition.authentication ?? []) {
    Object.defineProperty(securitySchemes, scheme.name, {
      value: toSecurityScheme(scheme),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  const hints = toHints(definition, operations);

  return {
    operations,
    securitySchemes,
    summary: {
      operationCount: operations.length,
      schemaCount,
      securitySchemeCount: Object.keys(securitySchemes).length,
      issues,
    },
    info: { title: definition.info.title, version: definition.info.version ?? "" },
    ...(definition.baseUrl !== undefined ? { declaredBaseUrl: definition.baseUrl } : {}),
    ...(hints.length > 0 ? { dependencyHints: hints } : {}),
  };
}
