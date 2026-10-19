import type { ApiModel, ApiOperation, EffectiveSecurity, GeneratableCategoryId, Prerequisite, SecurityMutation, SecurityScenarioContent } from "@apipilot/shared-domain";
import { EXPECTED_BEHAVIOR_KINDS } from "@apipilot/shared-domain";
import { isStateChangingMethod } from "../analysis/sensitivity";
import { operationKeyOf, resolveEffectiveSecurity } from "../analysis/effectiveSecurity";
import { isGeneratableCategoryId } from "../registry/categories";
import { isCredentialValue } from "../scenarios/credentialPlaceholders";
import { ROLE_ANY, expiredCredentialPrerequisite, identityPrerequisite, ownershipPrerequisite, thresholdPrerequisite } from "../scenarios/prerequisites";
import { isProductRuleId, productRuleStatement } from "../scenarios/productRules";
import { suggestedSeverityFor } from "../scenarios/suggestedSeverity";
import { makeContent, primaryScheme, requirementOf, type GenerationContext } from "../scenarios/rules/support";
import { validateScenario, type ScenarioViolation } from "../scenarios/validateScenario";
import type { SecurityLabLimits } from "../config";
import type { SuggestionCandidate } from "./parseSuggestionResponse";

/**
 * Turns one AI suggestion into a scenario, or says exactly why it cannot be one (specs/057 FR-064, research R17).
 *
 * The model supplies only what the closed vocabulary allows: an operation, a category, a handful of typed mutations and
 * conditions, a grounding for the expectation, and words. Everything else is **derived here, deterministically**: the
 * base request, the prerequisites and required identities, the planned request count, the destructive flag, the
 * taxonomy and the suggested severity, none of which a model can influence. The result then goes through
 * `validateScenario`, the same four-step pipeline as a generated or an edited scenario, so a URL, a host, a header
 * override, a repeat over the ceiling, an unsupported action, an unknown operation or field, an invented status code or
 * a credential is refused with a stable code. A refused suggestion never affects an accepted one.
 */

export interface SuggestionModel {
  readonly id: string;
}

export type SuggestionValidation =
  | { readonly ok: true; readonly content: SecurityScenarioContent }
  | { readonly ok: false; readonly violations: readonly ScenarioViolation[] };

const reject = (code: ScenarioViolation["code"], pointer: string, message: string): SuggestionValidation => ({ ok: false, violations: [{ code, pointer, message }] });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export interface ValidationContext {
  readonly apiModel: ApiModel;
  readonly limits: SecurityLabLimits;
  readonly model: SuggestionModel;
}

function generationContext(apiModel: ApiModel, limits: SecurityLabLimits): GenerationContext {
  return { apiModel, effective: new Map<string, EffectiveSecurity>(resolveEffectiveSecurity(apiModel).map((entry) => [entry.operationKey, entry])), limits, configuredSensitive: new Set() };
}

/** The prerequisites a set of mutations needs, derived only from their kinds and parameters. */
function prerequisitesFor(context: GenerationContext, operation: ApiOperation, mutations: readonly SecurityMutation[]): { prerequisites: Prerequisite[]; roles: string[] } {
  const { requiresCredentials, schemes } = requirementOf(context, operation);
  const scheme = requiresCredentials ? primaryScheme(context, schemes) : undefined;
  const key = operationKeyOf(operation);
  const byId = new Map<string, Prerequisite>();
  const roles = new Set<string>();
  const add = (prerequisite: Prerequisite) => byId.set(prerequisite.id, prerequisite);
  const needIdentity = (role: string) => {
    roles.add(role);
    if (scheme) add(identityPrerequisite(role, scheme));
  };

  let usesIdentity = false;
  for (const mutation of mutations) {
    switch (mutation.kind) {
      case "auth.expired":
        usesIdentity = true;
        needIdentity(mutation.identity);
        if (scheme) add(expiredCredentialPrerequisite(scheme));
        break;
      case "identity.swap":
        usesIdentity = true;
        needIdentity(mutation.from);
        needIdentity(mutation.to);
        break;
      case "path-id.substitute":
        usesIdentity = true;
        needIdentity(mutation.ownerIdentity);
        add(ownershipPrerequisite(key, mutation.parameter, mutation.ownerIdentity));
        break;
      case "request.repeat":
        add(thresholdPrerequisite(key));
        break;
      default:
        break;
    }
  }
  const sendsCredential = !mutations.some((mutation) => mutation.kind === "auth.omit" || mutation.kind === "auth.invalid-token" || mutation.kind === "auth.malformed");
  if (scheme && !usesIdentity && sendsCredential) needIdentity(ROLE_ANY);
  return { prerequisites: [...byId.values()], roles: [...roles] };
}

/** The free-text fields a model writes. A retained scenario must never hold a credential, so none may look like one. */
const TEXT_FIELDS = ["title", "objective", "rationale", "impact"] as const;
const TOKEN_SEPARATORS = /[\s,;:()"'`<>]+/;

function credentialInText(candidate: SuggestionCandidate): string | undefined {
  for (const field of TEXT_FIELDS) {
    if (candidate[field].split(TOKEN_SEPARATORS).some((token) => token !== "" && isCredentialValue(token))) return `/${field}`;
  }
  const index = candidate.assumptions.findIndex((entry) => entry.split(TOKEN_SEPARATORS).some((token) => token !== "" && isCredentialValue(token)));
  return index === -1 ? undefined : `/assumptions/${index}`;
}

export function validateSuggestion(candidate: SuggestionCandidate, context: ValidationContext): SuggestionValidation {
  const { apiModel, limits } = context;
  const operation = apiModel.operations.find((entry) => operationKeyOf(entry) === candidate.operationKey);
  if (!operation) return reject("unknown_operation", "/operationKey", `The operation '${candidate.operationKey}' is not in the specification.`);
  if (!isGeneratableCategoryId(candidate.categoryId)) {
    return reject("category_not_generatable", "/categoryId", `'${candidate.categoryId}' is not a category scenarios can be created for.`);
  }
  const categoryId: GeneratableCategoryId = candidate.categoryId;

  const credentialAt = credentialInText(candidate);
  if (credentialAt) return reject("credential_in_content", credentialAt, "Text that looks like a credential cannot be stored in a scenario.");

  if (candidate.mutations.length === 0 || candidate.mutations.length > 5) return reject("schema_violation", "/mutations", "A scenario needs between 1 and 5 mutations.");
  if (candidate.conditions.length === 0 || candidate.conditions.length > 8) return reject("schema_violation", "/conditions", "A scenario needs between 1 and 8 conditions.");
  const typed = candidate.mutations.filter((mutation): mutation is SecurityMutation => isRecord(mutation) && typeof mutation.kind === "string");
  if (typed.length !== candidate.mutations.length) return reject("schema_violation", "/mutations", "Every mutation must be an object with a 'kind'.");
  const conditions = candidate.conditions.filter(isRecord);
  if (conditions.length !== candidate.conditions.length) return reject("schema_violation", "/conditions", "Every condition must be an object with a 'kind'.");

  if (!(EXPECTED_BEHAVIOR_KINDS as readonly string[]).includes(candidate.expected.kind)) {
    return reject("schema_violation", "/expected/kind", `'expected.kind' must be one of ${EXPECTED_BEHAVIOR_KINDS.join(", ")}.`);
  }
  // The grounding is the system's, never the model's: a named product rule, or status codes the operation documents. Nothing else.
  const key = candidate.operationKey;
  const documentedCodes = (candidate.expected.documentedStatusCodes ?? []).filter((code): code is number => typeof code === "number" && Number.isInteger(code));
  const expected: SecurityScenarioContent["expected"] =
    candidate.expected.ruleId !== undefined && isProductRuleId(candidate.expected.ruleId)
      ? { kind: candidate.expected.kind as SecurityScenarioContent["expected"]["kind"], statement: productRuleStatement(candidate.expected.ruleId), basis: "product-rule", ruleId: candidate.expected.ruleId }
      : documentedCodes.length > 0
        ? {
            kind: candidate.expected.kind as SecurityScenarioContent["expected"]["kind"],
            statement: `The specification documents ${documentedCodes.join(", ")} for this operation, and the response is expected to be one of those statuses.`,
            basis: "documented",
            documentedStatusCodes: documentedCodes,
            citation: `/operations/${key}/responses`,
          }
        : { kind: candidate.expected.kind as SecurityScenarioContent["expected"]["kind"], statement: "", basis: "documented" };
  if (expected.basis === "documented" && !expected.documentedStatusCodes) {
    return reject("ungrounded_expectation", "/expected", "The expected behavior must name a product rule id, or status codes the operation documents.");
  }

  const generation = generationContext(apiModel, limits);
  const { prerequisites, roles } = prerequisitesFor(generation, operation, typed);
  const repeat = typed.find((mutation) => mutation.kind === "request.repeat");
  const stateChanging = isStateChangingMethod(operation.method);

  const built = makeContent({
    context: generation,
    operation,
    categoryId,
    ruleId: "ai.suggestion",
    title: candidate.title,
    objective: candidate.objective,
    rationale: candidate.rationale,
    impact: candidate.impact,
    // Boundary: the shapes are checked in full by `validateScenario` below, and nothing is accepted unless it passes.
    mutations: typed,
    expected,
    conditions: conditions as unknown as SecurityScenarioContent["conditions"],
    severity: suggestedSeverityFor(categoryId, typed[0].kind, stateChanging),
    prerequisites,
    requiredIdentities: roles.map((role) => ({ role, label: role === ROLE_ANY ? "An identity allowed to call the operation" : `An identity with the role "${role}"` })),
    plannedRequestCount: repeat && repeat.kind === "request.repeat" && Number.isInteger(repeat.count) ? repeat.count : 1,
    limitations: ["Suggested by a local AI model, then checked by the same rules as every scenario. Review it before approving."],
    manualInputs: [],
    specElementPointer: `/operations/${key}`,
  });
  const content: SecurityScenarioContent = {
    ...built,
    provenance: { ...built.provenance, aiModel: context.model.id, aiConfidence: candidate.confidence, aiAssumptions: [...candidate.assumptions] },
  };

  const validation = validateScenario(content, { apiModel, maxRepeat: limits.ceilings.maxRepeat });
  return validation.ok ? { ok: true, content } : { ok: false, violations: validation.violations };
}
