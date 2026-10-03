import type {
  ApiDependencyRelationship,
  ApiModel,
  ApiOperation,
  ArtifactVariable,
  GeneratedRequest,
  IntegrationWorkflow,
  PerformancePlanSourceKind,
  PostmanAuth,
  PostmanRequestItem,
  StepAuthKind,
  TestScenario,
} from "@apipilot/shared-domain";
import { BASE_URL_VARIABLE, pathParameterVariableName } from "../../postman/artifactVariables";
import { buildAuthCredentialRelationships } from "../../postman/authCredentialRelationships";
import { mapOperationAuth, planSchemeVariables, type SchemeVariablePlanEntry } from "../../postman/authMapping";
import { findCredentialProducers } from "../../postman/credentialProducers";
import { itemIdForOAuth2TokenFetch } from "../../postman/identifiers";
import { buildOAuth2SetupFolders } from "../../postman/oauth2TokenFetch";
import { buildRequestItem } from "../../postman/requestItem";
import { compareCodeUnits } from "../../postman/ordering";
import { selectPerformanceScenario } from "./selectScenario";

/**
 * One step's request as a template (specs/031-k6-performance-testing research D3, FR-011).
 *
 * The request is built by the Postman generator's own `buildRequestItem`, so URL, query, header
 * and body serialization are the functional tests' exactly. Only three things differ, each
 * recorded in research: a path parameter no workflow step produces is a user-supplied value
 * (spec US1 AS3) rather than the scenario's generated placeholder; FR-016's unique body fields
 * become per-iteration tokens; and auth tokens come from `setup()` instead of Postman scripts.
 * Every `{{name}}` left in a template is resolved at run time by the script.
 */
export type AuthTemplate =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "apikey"; in: "header" | "query"; key: string; value: string }
  | { kind: "basic"; username: string; password: string };

export interface RequestTemplate {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body?: string;
  /** AP-036 research R11: `form` is a collection `urlencoded` body, filled URL-encoded. */
  bodyKind?: "json" | "text" | "form";
  auth: AuthTemplate;
}

/** Where a token-authenticated step gets its token (FR-009, FR-015). */
export interface TokenSource {
  schemeName: string;
  kind: Extract<StepAuthKind, "oauth2-client-credentials" | "chained-login">;
  /** The template variable the consuming steps reference (for example `accessToken`). */
  tokenVariable: string;
  request: RequestTemplate;
  /** Dotted response-body field holding the token (`access_token` for OAuth2). */
  responseField: string;
  /** User-supplied names the token request itself needs. */
  envNames: string[];
  /**
   * AP-032 FR-003a: for `chained-login`, the login operation the token request calls. Absent for
   * OAuth2 client credentials, whose token request goes to the scheme's `tokenUrl`, not an operation.
   */
  producerOperationKey?: string;
}

/** Everything plan building and rendering read from the approved workflow state. */
export interface PerformanceContext {
  apiModel: ApiModel;
  approvedScenarios: TestScenario[];
  /** Approved workflows only, in id order. */
  workflows: IntegrationWorkflow[];
  relationships: ApiDependencyRelationship[];
  /** Absent means every analyzed operation (as `TestGenerationWorkflow.selectedOperationKeys`). */
  selectedOperationKeys?: string[];
  /** AP-032: the guided workflow's approvals, or a quick test's generated, unreviewed scenarios. */
  source: PerformancePlanSourceKind;
}

export interface AuthPlan {
  schemePlan: Map<string, SchemeVariablePlanEntry>;
  tokenSources: Map<string, TokenSource>;
}

export interface BuiltStepRequest {
  template: RequestTemplate;
  /** Every `{{name}}` the template references, in first-seen order. */
  references: string[];
  /** Names this step expects from the environment, sorted in code-unit order. */
  envNames: string[];
  /** Env names that are path parameters no operation produces. */
  pathParameterNames: string[];
  /** Names the Postman builders declared as secret. */
  secretNames: Set<string>;
  authKind: StepAuthKind;
  schemeName: string | null;
}

export const UNIQUE_TOKEN_PREFIX = "apipilot_unique_";
const REFERENCE = /\{\{([^{}]+)\}\}/g;
const ONLY_REFERENCE = /^\{\{[^{}]+\}\}$/;
const PATH_PARAMETER_SEGMENT = /^\{(.+)\}$/;

export function templateReferences(text: string): string[] {
  return [...text.matchAll(REFERENCE)].map((match) => match[1]);
}

export function operationKeyOf(operation: { method: string; path: string }): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function templateFromItem(item: PostmanRequestItem): RequestTemplate {
  const { url } = item.request;
  const pathValues = new Map(url.variable.map((variable) => [variable.key, variable.value]));
  const segments = url.path.map((segment) => (segment.startsWith(":") ? (pathValues.get(segment.slice(1)) ?? segment) : segment));
  const host = url.host[0] ?? `{{${BASE_URL_VARIABLE}}}`;
  const path = segments.length > 0 ? `/${segments.join("/")}` : "";
  const query = url.query.length > 0 ? `?${url.query.map((entry) => `${entry.key}=${entry.value}`).join("&")}` : "";
  const template: RequestTemplate = {
    method: item.request.method,
    url: `${host}${path}${query}`,
    headers: item.request.header.map((header) => ({ key: header.key, value: header.value })),
    auth: authTemplate(item.request.auth),
  };
  if (item.request.body) {
    template.body = item.request.body.raw;
    template.bodyKind = item.request.body.options?.raw.language === "json" ? "json" : "text";
  }
  return template;
}

function attributeValue(auth: { key: string; value: string }[], key: string): string {
  return auth.find((attribute) => attribute.key === key)?.value ?? "";
}

function authTemplate(auth: PostmanAuth | undefined): AuthTemplate {
  if (!auth) return { kind: "none" };
  if (auth.type === "bearer") return { kind: "bearer", token: attributeValue(auth.bearer, "token") };
  if (auth.type === "oauth2") return { kind: "bearer", token: attributeValue(auth.oauth2, "accessToken") };
  if (auth.type === "basic") {
    return { kind: "basic", username: attributeValue(auth.basic, "username"), password: attributeValue(auth.basic, "password") };
  }
  return {
    kind: "apikey",
    in: attributeValue(auth.apikey, "in") === "query" ? "query" : "header",
    key: attributeValue(auth.apikey, "key"),
    value: attributeValue(auth.apikey, "value"),
  };
}

function allTemplateText(template: RequestTemplate): string[] {
  const texts = [template.url, ...template.headers.flatMap((header) => [header.key, header.value])];
  if (template.body !== undefined) texts.push(template.body);
  const { auth } = template;
  if (auth.kind === "bearer") texts.push(auth.token);
  if (auth.kind === "apikey") texts.push(auth.value);
  if (auth.kind === "basic") texts.push(auth.username, auth.password);
  return texts;
}

function setDotted(target: unknown, fieldPath: string, value: string): unknown {
  if (target === null || typeof target !== "object" || Array.isArray(target)) return target;
  const [head, ...rest] = fieldPath.split(".");
  const record = { ...(target as Record<string, unknown>) };
  if (!(head in record)) return target;
  record[head] = rest.length === 0 ? value : setDotted(record[head], rest.join("."), value);
  return record;
}

/** Scheme variable plan and token sources, shared by every step of one plan (FR-009). */
export function planAuth(context: PerformanceContext): AuthPlan {
  const { apiModel } = context;
  const schemePlan = planSchemeVariables(apiModel.securitySchemes);
  const tokenSources = new Map<string, TokenSource>();

  for (const folder of buildOAuth2SetupFolders(apiModel.operations, apiModel.securitySchemes, schemePlan)) {
    for (const entry of folder.item) {
      if (!("request" in entry)) continue;
      const item = entry as PostmanRequestItem;
      const schemeName = [...schemePlan.keys()].find((key) => itemIdForOAuth2TokenFetch(key) === item.id);
      const planEntry = schemeName ? schemePlan.get(schemeName) : undefined;
      if (!schemeName || planEntry?.type !== "oauth2") continue;
      const template = templateFromItem(item);
      tokenSources.set(schemeName, {
        schemeName,
        kind: "oauth2-client-credentials",
        tokenVariable: planEntry.variableNames.accessToken,
        request: template,
        responseField: "access_token",
        envNames: uniqueSorted(allTemplateText(template).flatMap(templateReferences)),
      });
    }
  }

  const producers = findCredentialProducers(apiModel.operations, schemePlan);
  const relationships = buildAuthCredentialRelationships(apiModel.operations, producers);
  for (const candidate of producers) {
    const relationship = relationships.find((r) => r.consumer.field === candidate.schemeKey);
    const operation = apiModel.operations.find(
      (op) => operationKeyOf(op) === `${candidate.producerOperationMethod.toUpperCase()} ${candidate.producerOperationPath}`,
    );
    if (!relationship || !operation) continue;
    const selection = selectPerformanceScenario(context.approvedScenarios, operation);
    if ("omitted" in selection) continue;
    const built = buildStepRequest(context, { schemePlan, tokenSources: new Map() }, operation, selection.scenario, {});
    tokenSources.set(candidate.schemeKey, {
      schemeName: candidate.schemeKey,
      kind: "chained-login",
      tokenVariable: candidate.variableName,
      request: built.template,
      responseField: relationship.producer.field,
      envNames: built.envNames,
      producerOperationKey: operationKeyOf(operation),
    });
  }
  return { schemePlan, tokenSources };
}

function uniqueSorted(names: string[]): string[] {
  return [...new Set(names)].sort(compareCodeUnits);
}

/**
 * A value an earlier step of the same workflow produces, filled into this step's request as
 * `{{key}}` (AP-029 FR-010): a guided workflow variable, whose key is the Postman generator's
 * `workflowVariableName`. A body field is a dotted path written as the Postman generator writes it.
 */
export interface ConsumedValue {
  key: string;
  /** The variable name. */
  name: string;
  location: "path" | "query" | "header" | "body" | "auth";
  field: string;
}

function setDottedCreating(target: Record<string, unknown>, field: string, value: string): void {
  const parts = field.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const nested = current[part];
    if (typeof nested !== "object" || nested === null || Array.isArray(nested)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Writes `{{key}}` at each consumed value's target, as the Postman generator's workflow substitution does. */
function applyConsumedValues(scenario: TestScenario, consumed: readonly ConsumedValue[]): TestScenario {
  const request: GeneratedRequest = {
    pathParameters: { ...scenario.request.pathParameters },
    queryParameters: { ...scenario.request.queryParameters },
    headers: { ...scenario.request.headers },
    ...(scenario.request.body === undefined ? {} : { body: structuredClone(scenario.request.body) }),
  };
  for (const entry of consumed) {
    const value = `{{${entry.key}}}`;
    if (entry.location === "path") request.pathParameters[entry.field] = value;
    if (entry.location === "query") request.queryParameters[entry.field] = value;
    if (entry.location === "header") request.headers[entry.field] = value;
    if (entry.location === "body") setDottedCreating(request.body as Record<string, unknown>, entry.field, value);
  }
  return { ...scenario, request };
}

export interface StepRequestOptions {
  /** Values earlier steps produce, in the step's binding order. */
  consumed?: ConsumedValue[];
  /** FR-016: body fields replaced by a per-iteration token. */
  uniqueFields?: { fieldPath: string; token: string }[];
}

/** Builds one step's request template with the Postman request builder (FR-011). */
export function buildStepRequest(
  context: PerformanceContext,
  auth: AuthPlan,
  operation: ApiOperation,
  scenario: TestScenario,
  options: StepRequestOptions,
): BuiltStepRequest {
  const consumes = options.consumed ?? [];
  let effective = consumes.length > 0 ? applyConsumedValues(scenario, consumes) : scenario;

  // Spec US1 AS3: a path parameter no workflow step produces is a user-supplied value. Removing
  // the scenario's generated placeholder makes the Postman builder emit its own variable for it.
  const pathParameters = { ...effective.request.pathParameters };
  const pathParameterNames: string[] = [];
  for (const segment of operation.path.split("/")) {
    const parameter = PATH_PARAMETER_SEGMENT.exec(segment)?.[1];
    if (!parameter) continue;
    const value = pathParameters[parameter];
    if (typeof value === "string" && ONLY_REFERENCE.test(value)) continue;
    delete pathParameters[parameter];
    pathParameterNames.push(pathParameterVariableName(operation.path, parameter));
  }
  let body = effective.request.body;
  for (const unique of options.uniqueFields ?? []) body = setDotted(body, unique.fieldPath, `{{${unique.token}}}`);
  effective = {
    ...effective,
    request: { ...effective.request, pathParameters, ...(body === undefined ? {} : { body }) },
  };

  const mapped = mapOperationAuth(operation, context.apiModel.securitySchemes, auth.schemePlan);
  const built = buildRequestItem({ scenario: effective, operation, requestName: operationKeyOf(operation), auth: mapped.auth });
  const template = templateFromItem(built.item);

  const schemeName = operation.security[0]?.schemes[0]?.name ?? null;
  const planEntry = schemeName ? auth.schemePlan.get(schemeName) : undefined;
  const tokenSource = schemeName ? auth.tokenSources.get(schemeName) : undefined;
  let authKind: StepAuthKind = "none";
  if (template.auth.kind !== "none") {
    if (tokenSource) authKind = tokenSource.kind;
    else if (planEntry?.type === "oauth2") authKind = "oauth2-client-credentials";
    else authKind = "static-credential";
  }

  const references = [...new Set(allTemplateText(template).flatMap(templateReferences))];
  const workflowNames = new Set(consumes.map((entry) => entry.key));
  const envNames = references.filter(
    (name) =>
      !workflowNames.has(name) &&
      !name.startsWith(UNIQUE_TOKEN_PREFIX) &&
      !(tokenSource && name === tokenSource.tokenVariable),
  );
  if (tokenSource) envNames.push(...tokenSource.envNames);

  const variables: ArtifactVariable[] = [...built.variables, ...mapped.variables];
  return {
    template,
    references,
    envNames: uniqueSorted(envNames),
    pathParameterNames: uniqueSorted(pathParameterNames),
    secretNames: new Set(variables.filter((variable) => variable.secret).map((variable) => variable.name)),
    authKind,
    schemeName: authKind === "none" ? null : schemeName,
  };
}
