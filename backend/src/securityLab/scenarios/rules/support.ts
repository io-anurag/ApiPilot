import type {
  ApiModel,
  ApiOperation,
  EffectiveSecurity,
  EvaluationCondition,
  ExpectedBehavior,
  GeneratableCategoryId,
  GeneratedRequest,
  Prerequisite,
  SecurityMutation,
  SecurityProfile,
  SecurityScenarioContent,
  Severity,
} from "@apipilot/shared-domain";
import { operationKeyOf, schemeNamesOf } from "../../analysis/effectiveSecurity";
import { CREDENTIAL_PLACEHOLDER, isCredentialFieldName, isCredentialValue, isPlaceholder } from "../credentialPlaceholders";
import { buildMinimalConformantRequest } from "../../../testDesign/requestHelpers";
import type { SecurityLabLimits } from "../../config";
import { taxonomyFor } from "../../registry/categories";
import { destructiveFor } from "../destructive";
import { productRuleStatement, type ProductRuleId } from "../productRules";

/** Everything a scenario rule may read. Rules are pure functions of this context and one operation. */
export interface GenerationContext {
  readonly apiModel: ApiModel;
  readonly effective: ReadonlyMap<string, EffectiveSecurity>;
  /** Present only when the engineer selected a profile; used for thresholds and for permitted categories. */
  readonly profile?: SecurityProfile;
  readonly limits: SecurityLabLimits;
  /** Sensitive field names the user configured, lowercase. Recorded as user-provided, never as fact. */
  readonly configuredSensitive: ReadonlySet<string>;
}

export interface GenerationNote {
  readonly categoryId: GeneratableCategoryId;
  readonly operationKey?: string;
  readonly reason: string;
}

export interface RuleOutput {
  readonly contents: SecurityScenarioContent[];
  readonly notes: GenerationNote[];
}

export interface ScenarioRule {
  readonly id: string;
  readonly categoryId: GeneratableCategoryId;
  run(context: GenerationContext, operation: ApiOperation): RuleOutput;
}

export const NO_OUTPUT: RuleOutput = Object.freeze({ contents: [], notes: [] }) as RuleOutput;

/** Whether the operation's effective requirement makes credentials necessary, and which schemes it names. */
export function requirementOf(context: GenerationContext, operation: ApiOperation): { requiresCredentials: boolean; schemes: string[] } {
  return credentialRequirementOf(context.effective.get(operationKeyOf(operation)));
}

/** The same decision from an operation's resolved effective security, for code that has no generation context. */
export function credentialRequirementOf(effective: EffectiveSecurity | undefined): { requiresCredentials: boolean; schemes: string[] } {
  if (!effective || (effective.source !== "operation" && effective.source !== "root")) return { requiresCredentials: false, schemes: [] };
  if (effective.requirement.length === 0 || effective.requirement.some((entry) => entry.schemes.length === 0)) {
    return { requiresCredentials: false, schemes: [] };
  }
  return { requiresCredentials: true, schemes: schemeNamesOf(effective.requirement) };
}

/** The scheme names the sender can send a credential for (everything except an unknown or unsupported type). */
const SUPPORTED_HTTP_SCHEMES = new Set(["bearer", "basic"]);

export function isExpressibleScheme(context: GenerationContext, name: string): boolean {
  return isExpressibleSchemeIn(context.apiModel, name);
}

/** The same rule for code that has a model but no generation context, such as the request builder. */
export function isExpressibleSchemeIn(apiModel: ApiModel, name: string): boolean {
  const definition = apiModel.securitySchemes[name];
  if (!definition) return false;
  switch (definition.type) {
    case "http":
      return SUPPORTED_HTTP_SCHEMES.has((definition.scheme ?? "").toLowerCase());
    case "apiKey":
      return definition.in === "header" || definition.in === "query" || definition.in === "cookie";
    case "oauth2":
    case "openIdConnect":
      // Sent as a bearer token the engineer supplies. ApiPilot never performs the OAuth flow or obtains a token.
      return true;
    default:
      return false;
  }
}

/** The first scheme of the operation's requirement that the sender can express. */
export function primaryScheme(context: GenerationContext, schemes: readonly string[]): string | undefined {
  return schemes.find((name) => isExpressibleScheme(context, name));
}

function sanitizeValue(name: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (isPlaceholder(value)) return value;
    return isCredentialFieldName(name) || isCredentialValue(value) ? CREDENTIAL_PLACEHOLDER : value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(name, item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, sanitizeValue(key, child)]));
  }
  return value;
}

/** A conformant base request with every credential-shaped value replaced by a placeholder (retained rows hold no secret). */
export function baseRequestFor(operation: ApiOperation): GeneratedRequest {
  const request = buildMinimalConformantRequest(operation);
  return {
    pathParameters: Object.fromEntries(Object.entries(request.pathParameters).map(([k, v]) => [k, sanitizeValue(k, v)])),
    queryParameters: Object.fromEntries(Object.entries(request.queryParameters).map(([k, v]) => [k, sanitizeValue(k, v)])),
    headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, sanitizeValue(k, v)])),
    ...(request.body === undefined ? {} : { body: sanitizeValue("body", request.body) }),
  };
}

/** The documented status codes of `operation` that are among `candidates`, ascending. */
export function documentedCodes(operation: ApiOperation, candidates: readonly number[]): number[] {
  return operation.responses
    .map((response) => Number(response.statusCode))
    .filter((code) => Number.isInteger(code) && candidates.includes(code))
    .sort((a, b) => a - b);
}

/**
 * The expected behavior and conditions of a "must be rejected" scenario (contracts section 5). Where the
 * specification documents one of `candidateCodes`, the scenario cites it and judges against it; otherwise the named
 * product rule applies and no status is invented. Pass `null` to always use the product rule (ownership failures
 * are reported as 403 or 404 by different services, so the rule is the honest expectation).
 */
export function rejectionExpectation(
  operation: ApiOperation,
  candidateCodes: readonly number[] | null,
  ruleId: ProductRuleId,
): { expected: ExpectedBehavior; conditions: EvaluationCondition[] } {
  const documented = candidateCodes ? documentedCodes(operation, candidateCodes) : [];
  const key = operationKeyOf(operation);
  if (documented.length > 0) {
    return {
      expected: {
        kind: "rejected",
        statement: `The specification documents ${documented.join(" or ")} for this operation, so the request must be rejected with ${
          documented.length === 1 ? "that status" : "one of those statuses"
        }.`,
        basis: "documented",
        documentedStatusCodes: documented,
        citation: `/operations/${key}/responses`,
      },
      conditions: [{ kind: "status.in-set", codes: documented }],
    };
  }
  return {
    expected: { kind: "rejected", statement: productRuleStatement(ruleId), basis: "product-rule", ruleId },
    conditions: [{ kind: "status.not-success" }],
  };
}

export interface ContentInput {
  readonly context: GenerationContext;
  readonly operation: ApiOperation;
  readonly categoryId: GeneratableCategoryId;
  readonly ruleId: string;
  readonly title: string;
  readonly objective: string;
  readonly rationale: string;
  readonly impact: string;
  readonly mutations: SecurityMutation[];
  readonly expected: ExpectedBehavior;
  readonly conditions: EvaluationCondition[];
  readonly severity: Severity;
  readonly prerequisites?: Prerequisite[];
  readonly requiredIdentities?: SecurityScenarioContent["requiredIdentities"];
  readonly limitations?: string[];
  readonly manualInputs?: string[];
  readonly plannedRequestCount?: number;
  readonly baseRequest?: GeneratedRequest;
  readonly specElementPointer?: string;
  readonly observationId?: string;
}

/** Assembles scenario content with every required field filled and the destructive flag derived. */
export function makeContent(input: ContentInput): SecurityScenarioContent {
  const { operation } = input;
  const key = operationKeyOf(operation);
  const origin = operation.provenance?.origin;
  return {
    operationKey: key,
    operationMethod: operation.method.toUpperCase(),
    operationPath: operation.path,
    categoryId: input.categoryId,
    taxonomy: taxonomyFor(input.categoryId),
    title: input.title,
    objective: input.objective,
    rationale: input.rationale,
    prerequisites: input.prerequisites ?? [],
    requiredIdentities: input.requiredIdentities ?? [],
    baseRequest: input.baseRequest ?? baseRequestFor(operation),
    mutations: input.mutations,
    expected: input.expected,
    conditions: input.conditions,
    impact: input.impact,
    suggestedSeverity: input.severity,
    destructive: destructiveFor(operation, input.mutations),
    plannedRequestCount: input.plannedRequestCount ?? 1,
    limitations: input.limitations ?? [],
    manualInputs: input.manualInputs ?? [],
    provenance: {
      operationKey: key,
      specElementPointer: input.specElementPointer ?? `/operations/${key}/security`,
      ruleId: input.ruleId,
      ...(input.observationId ? { observationId: input.observationId } : {}),
    },
    ...(origin === "observed" || origin === "inferred" || origin === "declared"
      ? {
          evidenceOrigin: origin,
          ...(operation.provenance?.observationCount !== undefined ? { observationCount: operation.provenance.observationCount } : {}),
        }
      : {}),
  };
}
