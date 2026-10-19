import type { AcceptedSuggestion, AIErrorCategory, AIProvider, RejectedSuggestion, SecurityScenarioContent, SuggestReply } from "@apipilot/shared-domain";
import { GENERATABLE_CATEGORY_IDS } from "@apipilot/shared-domain";
import { specificationRevision } from "../../apiCoverage/specRevision";
import { createLogger } from "../../logger";
import { operationKeyOf, resolveEffectiveSecurity } from "../analysis/effectiveSecurity";
import { basisHashes } from "../analysis/securityBasisHash";
import { SecurityLabError, invalidRequest, noSpecification, retentionLimitReached } from "../errors";
import { isGeneratableCategoryId } from "../registry/categories";
import { assessmentOf } from "../retention/assessmentKey";
import { contentHashOf, scenarioIdOf } from "../scenarios/scenarioIdentity";
import type { ScenarioContext } from "../scenarios/scenarioService";
import { parseSuggestionResponse } from "./parseSuggestionResponse";
import { MAX_PROMPT_OPERATIONS, buildSuggestionRequest, digestOperation } from "./suggestionPrompt";
import { validateSuggestion } from "./validateSuggestion";

/**
 * Optional, locally run suggestions (specs/057 FR-064, research R17, constitution XV, XXIX). It talks to the model only
 * through the `AIProvider` abstraction, sends it the shape of some operations and nothing else, and stores what survives
 * validation as a **draft** marked as AI-origin. A suggestion never executes, never approves, never decides an
 * outcome and never replaces a scenario that exists. When no provider is available every other capability is
 * unaffected: this one function answers `ai_unavailable` with the reason, and nothing else degrades (SC-015).
 */

const logger = createLogger("securityLab.suggest");

export interface SuggestRequest {
  readonly operationKeys?: readonly string[];
  readonly categories?: readonly string[];
}

export interface SuggestDeps {
  readonly provider: AIProvider;
  readonly newId: () => string;
}

export function parseSuggestRequest(body: unknown): SuggestRequest {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw invalidRequest("The request body must be an object.");
  const record = body as Record<string, unknown>;
  const list = (value: unknown, field: string): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0 || value.length > 50 || value.some((entry) => typeof entry !== "string")) {
      throw invalidRequest(`'${field}' must be a non-empty array of at most 50 strings.`);
    }
    return value as string[];
  };
  const categories = list(record.categories, "categories");
  for (const category of categories ?? []) {
    if (!isGeneratableCategoryId(category)) {
      throw new SecurityLabError("category_not_generatable", `'${category}' is not a category scenarios can be created for. Choose from ${GENERATABLE_CATEGORY_IDS.join(", ")}.`);
    }
  }
  return { operationKeys: list(record.operationKeys, "operationKeys"), categories };
}

function unavailableMessage(category: AIErrorCategory): string {
  switch (category) {
    case "NOT_READY":
      return "The local AI model is not ready, so no scenarios were suggested.";
    case "LOAD_FAILED":
      return "The local AI model could not be loaded, so no scenarios were suggested.";
    case "TIMEOUT":
      return "The local AI model did not answer in time, so no scenarios were suggested.";
    case "INVALID_REQUEST":
      return "The request was too large for the local AI model, so no scenarios were suggested. Choose fewer operations.";
    case "INVALID_RESPONSE":
      return "The local AI model's answer could not be used, so no scenarios were suggested.";
    case "PROVIDER_UNAVAILABLE":
      return "The local AI provider is unavailable, so no scenarios were suggested.";
  }
}

const unavailable = (message: string, category?: AIErrorCategory) => new SecurityLabError("ai_unavailable", message, category ? { aiErrorCategory: category } : {});

export async function suggestScenarios(context: ScenarioContext, deps: SuggestDeps, request: SuggestRequest): Promise<SuggestReply> {
  const model = context.workflow?.apiModel;
  if (!model) throw noSpecification();

  // Readiness first: with no provider, nothing else in Security Lab changes (SC-015).
  const readiness = deps.provider.getReadiness();
  if (readiness.state === "unavailable") {
    throw new SecurityLabError("ai_unavailable", `The local AI model is unavailable: ${readiness.reason ?? "no reason was given"}.`, { readiness: { state: readiness.state, reason: readiness.reason } });
  }

  const known = new Map(model.operations.map((operation) => [operationKeyOf(operation), operation]));
  for (const key of request.operationKeys ?? []) if (!known.has(key)) throw invalidRequest(`'${key}' is not an operation of the loaded specification.`);
  const wanted = (request.operationKeys ?? [...known.keys()]).slice().sort((a, b) => a.localeCompare(b)).slice(0, MAX_PROMPT_OPERATIONS);
  const effective = new Map(resolveEffectiveSecurity(model).map((entry) => [entry.operationKey, entry]));
  const operations = wanted.map((key) => digestOperation(known.get(key) as NonNullable<ReturnType<typeof known.get>>, effective.get(key)));
  const categories = request.categories ?? [...GENERATABLE_CATEGORY_IDS];

  const response = await deps.provider.infer(buildSuggestionRequest(deps.newId(), { operations, categories }));
  if (response.status !== "success" || response.content === undefined) {
    const category = response.errorCategory ?? "PROVIDER_UNAVAILABLE";
    logger.error("suggest_failed", { errorCategory: category });
    throw unavailable(unavailableMessage(category), category);
  }
  let parsed: ReturnType<typeof parseSuggestionResponse>;
  try {
    parsed = parseSuggestionResponse(response.content);
  } catch {
    logger.error("suggest_failed", { errorCategory: "INVALID_RESPONSE" });
    throw unavailable(unavailableMessage("INVALID_RESPONSE"), "INVALID_RESPONSE");
  }

  const accepted: AcceptedSuggestion[] = [];
  const rejected: RejectedSuggestion[] = [];
  const valid: Array<{ id: string; content: SecurityScenarioContent }> = [];
  const seen = new Set<string>();

  for (const suggestion of parsed.suggestions) {
    if (!suggestion.ok) {
      rejected.push({ index: suggestion.index, reason: suggestion.reason, violations: [{ pointer: "", code: "schema_violation", message: suggestion.reason }] });
      continue;
    }
    const { candidate } = suggestion;
    const outcome = validateSuggestion(candidate, { apiModel: model, limits: context.limits, model: { id: response.modelId } });
    if (!outcome.ok) {
      const first = outcome.violations[0];
      rejected.push({ index: suggestion.index, operationKey: candidate.operationKey, title: candidate.title, reason: `${first.code}: ${first.message}`, violations: outcome.violations.map((violation) => ({ pointer: violation.pointer, code: violation.code, message: violation.message })) });
      continue;
    }
    const id = scenarioIdOf({ operationKey: outcome.content.operationKey, categoryId: outcome.content.categoryId, mutations: outcome.content.mutations });
    if (seen.has(id) || context.repo.getScenario(context.ownerId, id)) {
      rejected.push({ index: suggestion.index, operationKey: candidate.operationKey, title: candidate.title, reason: `duplicate: this scenario already exists as ${id}, so the suggestion was not stored.`, violations: [{ pointer: "", code: "duplicate", message: `Already exists as ${id}.` }] });
      continue;
    }
    seen.add(id);
    valid.push({ id, content: outcome.content });
  }

  if (valid.length > 0) {
    if (context.repo.countByOwner(context.ownerId) + valid.length > context.limits.retention.maxScenarios) {
      throw retentionLimitReached("scenarios", context.limits.retention.maxScenarios);
    }
    const workflow = context.workflow;
    const assessment = assessmentOf(model, workflow?.specificationFilename);
    const revision = specificationRevision(model);
    const basis = basisHashes(model);
    const now = context.now().toISOString();
    for (const { id, content } of valid) {
      context.repo.insertScenario(
        { id, ownerId: context.ownerId, assessmentKey: assessment.key, assessmentLabel: assessment.label, currentVersion: 1, reviewState: "draft", executionStatus: "not_run", origin: "ai", createdAt: now },
        { operationKey: content.operationKey, categoryId: content.categoryId, severity: content.suggestedSeverity, destructive: content.destructive.flag, title: content.title },
        now,
      );
      context.repo.insertVersion(context.ownerId, {
        scenarioId: id,
        version: 1,
        contentHash: contentHashOf(content),
        specificationRevision: revision,
        securityBasisHash: basis.get(content.operationKey) ?? "",
        content,
        author: "ai",
        createdAt: now,
        materialChange: false,
      });
      accepted.push({ id, title: content.title, operationKey: content.operationKey, categoryId: content.categoryId });
    }
  }

  logger.info("suggest_finished", { accepted: accepted.length, rejected: rejected.length, ignored: parsed.ignored });
  return { accepted, rejected, model: response.modelId, ignored: parsed.ignored };
}
