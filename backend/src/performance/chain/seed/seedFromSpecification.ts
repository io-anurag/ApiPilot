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
 * variables, values the specification cannot produce stay `{{name}}` references, and each credential
 * producer becomes a Once before load step with an extractor, in a first chain "Credentials". Login
 * operations are left out of the per-operation chains (AP-032 FR-003a). Nothing is guessed: expected
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

/** The seed of a specification plan: credential steps first, then one single-step chain per operation. */
export function seedFromSpecification(context: PerformanceContext, filename: string, name: string, now: string): Omit<SeedInput, "environment"> {
  const auth = planAuth(context);
  const producers = new Set(credentialProducerOperationKeys(auth));
  const credentialSteps = [...auth.tokenSources.values()].sort((a, b) => (a.schemeName < b.schemeName ? -1 : a.schemeName > b.schemeName ? 1 : 0)).map((source) => credentialStep(source, context));
  const chains: SeedInput["chains"] = credentialSteps.length > 0 ? [{ name: "Credentials", steps: credentialSteps }] : [];
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
    chains.push({ name: key, steps: [seeded.step] });
  }
  // The OAuth2 client secret is secret by the scheme's own variable plan, never by its name.
  for (const entry of auth.schemePlan.values()) if (entry.type === "oauth2") secretNames.push(referenceName(entry.variableNames.clientSecret));
  return { name, chains, secretNames, now, report: { source: { kind: "specification", filename }, seededAt: now, items } };
}
