import type { ApiOperation, SchemaConstraint } from "@apipilot/shared-domain";
import { parseCapturePath } from "@apipilot/shared-domain";
import { primaryRequestBodySchema } from "../../../testDesign/requestHelpers";
import { credentialProducerOperationKeys } from "../../plan/buildPlan";
import { operationsInScope } from "../../plan/buildJourneys";
import { prefillExpectedStatuses } from "../../plan/expectedStatuses";
import { selectPerformanceScenario } from "../../plan/selectScenario";
import { buildStepRequest, operationKeyOf, planAuth, type AuthPlan, type PerformanceContext, type TokenSource } from "../../plan/stepRequest";
import { uniqueValueCandidates } from "../../plan/uniqueValueFields";
import type { SeedInput, SeedStep } from "./assembleSeededPlan";
import { referenceName, toChainRequest } from "./toChainStep";

/**
 * Seeding from a specification (specs/037-request-chain-performance FR-021, FR-022, FR-023; research
 * R15). The existing builders produce, once, the request AP-029 and AP-032 send for each operation's
 * chosen positive scenario; seeding keeps it as concrete text. Unique body fields become dynamic
 * variables, values the specification cannot produce stay `{{name}}` references, and a selected
 * credential producer becomes a Once before load step with an extractor, in a first chain
 * "Credentials" (see `seedFromSpecification`). Login operations are not repeated as per-operation
 * chains (AP-032 FR-003a). Nothing is guessed: expected
 * statuses are the documented success codes. Seeding sends nothing and runs nothing.
 */

/** Dotted paths of the request body's `format: password` fields, for FR-027. */
export function passwordFieldsOf(operation: ApiOperation): string[] {
  const schema = primaryRequestBodySchema(operation);
  const paths: string[] = [];
  const walk = (node: SchemaConstraint, prefix: string) => {
    for (const [name, property] of Object.entries(node.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (property.format === "password") paths.push(path);
      if (property.properties) walk(property, path);
    }
  };
  if (schema) walk(schema, "");
  return paths.filter((path) => parseCapturePath(path).ok);
}

/** The Once before load step a token source becomes (FR-022). */
export function credentialStep(source: TokenSource, context: PerformanceContext): SeedStep {
  const operation = source.producerOperationKey ? context.apiModel.operations.find((candidate) => operationKeyOf(candidate) === source.producerOperationKey) : undefined;
  const converted = toChainRequest(source.request, `${source.schemeName}_basic`);
  const label = operation ? operationKeyOf(operation) : `Token request of the security scheme ${source.schemeName}`;
  return {
    name: operation ? `${operation.operationId ?? label} (token)` : `Get a token (${source.schemeName})`,
    request: converted.request,
    // OAuth2 client credentials answer 200 by RFC 6749 section 5.1; a login operation, its documented codes.
    expectedStatuses: operation ? prefillExpectedStatuses(operation) : ["200"],
    extractors: [{ name: referenceName(source.tokenVariable), source: { kind: "body", path: source.responseField } }],
    runs: "once-before-load",
    source: {
      kind: "operation",
      operationKey: operation ? operationKeyOf(operation) : `securityScheme:${source.schemeName}`,
      label,
      passwordFields: operation ? passwordFieldsOf(operation) : [],
    },
  };
}

export interface OperationSeed {
  step: SeedStep | null;
  secretNames: string[];
  basicValueName: string | null;
}

/** One operation's step from its chosen positive scenario, or `null` when it has none. */
export function operationStep(context: PerformanceContext, auth: AuthPlan, operation: ApiOperation): OperationSeed {
  const selection = selectPerformanceScenario(context.approvedScenarios, operation);
  if ("omitted" in selection) return { step: null, secretNames: [], basicValueName: null };
  const uniqueFields = uniqueValueCandidates(operation, selection.scenario.request.body).map((candidate) => ({
    fieldPath: candidate.fieldPath,
    token: candidate.format === "uuid" ? "$guid" : "$randomEmail",
  }));
  const built = buildStepRequest(context, auth, operation, selection.scenario, { uniqueFields });
  const key = operationKeyOf(operation);
  const converted = toChainRequest(built.template, `${built.schemeName ?? "basic"}_basic`);
  return {
    step: {
      name: operation.operationId ?? key,
      request: converted.request,
      expectedStatuses: prefillExpectedStatuses(operation),
      extractors: [],
      runs: "every-iteration",
      source: { kind: "operation", operationKey: key, label: key, passwordFields: passwordFieldsOf(operation) },
    },
    secretNames: [...built.secretNames].map(referenceName),
    basicValueName: converted.basicValueName,
  };
}

export function basicAuthItem(label: string, valueName: string): SeedInput["report"]["items"][number] {
  return {
    kind: "basic-auth-encoded-value",
    sourceLabel: label,
    detail: `Basic auth is sent as the header Authorization: Basic {{${valueName}}}. Set ${valueName} to the Base64 of user:password in the target environment.`,
  };
}

/** Whether any seeded step sends the token a source produces, as `{{name}}` anywhere in its request. */
function tokenIsUsed(source: TokenSource, steps: readonly SeedStep[]): boolean {
  const reference = `{{${referenceName(source.tokenVariable)}}}`;
  return steps.some((step) => JSON.stringify(step.request).includes(reference));
}

/**
 * The seed of a specification plan: one single-step chain per selected operation, preceded by a
 * "Credentials" chain only for the token sources the engineer asked for. A token operation (a login,
 * an API-key issuer) is an ordinary operation: it is seeded as a Once before load step when it is
 * selected, and not at all when it is not. A token source with no operation behind it (OAuth2 client
 * credentials) cannot be selected, so it is seeded only when a seeded step sends its token. Endpoints
 * that need no token never cause a credential step.
 */
export function seedFromSpecification(context: PerformanceContext, filename: string, name: string, now: string): Omit<SeedInput, "environment"> {
  const auth = planAuth(context);
  const producers = new Set(credentialProducerOperationKeys(auth));
  const inScope = new Set(operationsInScope(context).map(operationKeyOf));
  const operationChains: SeedInput["chains"] = [];
  const items: SeedInput["report"]["items"] = [];
  const secretNames: string[] = [];
  for (const operation of operationsInScope(context)) {
    const key = operationKeyOf(operation);
    if (producers.has(key)) continue;
    const seeded = operationStep(context, auth, operation);
    if (!seeded.step) {
      items.push({ kind: "no-positive-scenario", sourceLabel: key, detail: "The operation has no positive scenario, so no step was seeded for it." });
      continue;
    }
    secretNames.push(...seeded.secretNames);
    if (seeded.basicValueName) {
      secretNames.push(seeded.basicValueName);
      items.push(basicAuthItem(key, seeded.basicValueName));
    }
    operationChains.push({ name: key, steps: [seeded.step] });
  }
  const operationSteps = operationChains.flatMap((chain) => chain.steps);
  const sources = [...auth.tokenSources.values()]
    .filter((source) => (source.producerOperationKey ? inScope.has(source.producerOperationKey) : tokenIsUsed(source, operationSteps)))
    .sort((a, b) => (a.schemeName < b.schemeName ? -1 : a.schemeName > b.schemeName ? 1 : 0));
  const credentialSteps = sources.map((source) => credentialStep(source, context));
  const chains: SeedInput["chains"] = credentialSteps.length > 0 ? [{ name: "Credentials", steps: credentialSteps }, ...operationChains] : operationChains;
  // The OAuth2 client secret is secret by the scheme's own variable plan, never by its name.
  const seededSchemes = new Set(sources.map((source) => source.schemeName));
  for (const [schemeName, entry] of auth.schemePlan) if (entry.type === "oauth2" && seededSchemes.has(schemeName)) secretNames.push(referenceName(entry.variableNames.clientSecret));
  return { name, chains, secretNames, now, report: { source: { kind: "specification", filename }, seededAt: now, items } };
}
