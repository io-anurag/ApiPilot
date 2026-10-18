import {
  SECURITY_REVIEW_ACTIONS,
  TAXONOMY_EDITION,
  type ScenarioDetail,
  type SecurityProfile,
  type SecurityReviewAction,
  type TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import { specificationRevision } from "../apiCoverage/specRevision";
import { getSecurityCredentialRepository } from "../persistence/securityCredentialRepository";
import { getSecurityProfileRepository } from "../persistence/securityProfileRepository";
import { getSecurityRunRepository } from "../persistence/securityRunRepository";
import { getSecurityScenarioRepository } from "../persistence/securityScenarioRepository";
import { getSessionId } from "../session/sessionContext";
import { getCurrentWorkflow } from "../testGenerationWorkflow/workflowStore";
import { basisHashes } from "./analysis/securityBasisHash";
import { analyzeSecurity } from "./analysis/analyzeSecurity";
import { loadSecurityLabLimits, type SecurityLabLimits } from "./config";
import { environmentService, parseTargetInput } from "./environments/environmentService";
import { invalidRequest, noSpecification, profileNotFound, scenarioNotFound } from "./errors";
import { getOwnerId } from "./owner/ownerContext";
import { listCategories } from "./registry/categories";
import { TAXONOMY_EDITIONS } from "./registry/taxonomy";
import {
  checkProfile,
  createProfile,
  deleteProfile,
  getCredentialStatus,
  getProfile,
  listProfiles,
  setCredential,
  systemNameResolver,
  updateProfile,
  type NameResolver,
  type ProfileContext,
} from "./profiles/profileService";
import { editScenario, reviewItems, type ReviewContext } from "./review/reviewService";
import {
  flagResolver,
  generateScenarios,
  getScenarioDetail,
  getScope,
  listScenarioIds,
  listScenarios,
  parseGenerateRequest,
  parseListQuery,
  type ScenarioContext,
} from "./scenarios/scenarioService";
import { getSettings, putSettings } from "./settings/settingsService";

/**
 * The Security Lab façade (specs/057 plan, "Structure"). The router calls only this; it is also the entry
 * point the direct-bypass tests use to prove every safety rule holds with no router and no UI in the way
 * (FR-036). Every dependency is injected, so tests supply a fixed clock, a fake sender and resolver, and a
 * stub AI provider, and never touch the public network (constitution XXI).
 *
 * The owner id (retained work) and the session id (session data) are read inside each method from the
 * request context, so a route never passes either as a parameter.
 */

export interface SecurityLabDependencies {
  /** The guided workflow of the calling session, which holds the loaded specification. */
  getWorkflow: () => TestGenerationWorkflow | undefined;
  now: () => Date;
  limits: SecurityLabLimits;
  /** Resolves a host name for `POST /profiles/:id/check`. Injected so tests never touch a network. */
  resolveName: NameResolver;
}

export function defaultSecurityLabDependencies(): SecurityLabDependencies {
  return {
    getWorkflow: getCurrentWorkflow,
    now: () => new Date(),
    limits: loadSecurityLabLimits(),
    resolveName: systemNameResolver,
  };
}

export function createSecurityLabService(overrides: Partial<SecurityLabDependencies> = {}) {
  const deps: SecurityLabDependencies = { ...defaultSecurityLabDependencies(), ...overrides };

  /** The loaded specification, or the typed error that routes marked "needs a specification" return. */
  function requireWorkflow(): TestGenerationWorkflow & { apiModel: NonNullable<TestGenerationWorkflow["apiModel"]> } {
    const workflow = deps.getWorkflow();
    if (!workflow?.apiModel) throw noSpecification();
    return workflow as TestGenerationWorkflow & { apiModel: NonNullable<TestGenerationWorkflow["apiModel"]> };
  }

  /** The label recorded as the actor of a review decision. ApiPilot is single-user per browser. */
  const ACTOR = "local user";

  /** The profile for a request, from the calling session's own profiles, with a credential check that never reveals a value. */
  function resolveProfile(profileId: string | undefined): { profile?: SecurityProfile; hasCredential: ScenarioContext["hasCredential"] } {
    if (!profileId) return { hasCredential: () => false };
    const sessionId = getSessionId();
    const profile = getSecurityProfileRepository().get(sessionId, profileId);
    if (!profile) throw profileNotFound(profileId);
    const credentials = getSecurityCredentialRepository();
    return {
      profile,
      hasCredential: (identity, scheme, kind) => credentials.isSet(sessionId, { profileId: profile.id, identity, scheme, kind }),
    };
  }

  function scenarioContext(profileId?: string): ScenarioContext {
    const resolved = resolveProfile(profileId);
    return {
      ownerId: getOwnerId(),
      actor: ACTOR,
      now: deps.now,
      limits: deps.limits,
      repo: getSecurityScenarioRepository(),
      workflow: deps.getWorkflow(),
      profile: resolved.profile,
      hasCredential: resolved.hasCredential,
      configuredSensitiveFields: getSettings(getOwnerId()).sensitiveFields,
    };
  }

  function reviewContext(context: ScenarioContext): ReviewContext {
    return { repo: context.repo, now: context.now, actor: context.actor, flagsFor: flagResolver(context) };
  }

  function profileContext(): ProfileContext {
    return {
      sessionId: getSessionId(),
      now: deps.now,
      limits: deps.limits,
      profiles: getSecurityProfileRepository(),
      credentials: getSecurityCredentialRepository(),
      runs: getSecurityRunRepository(),
      getEnvironment: (id) => environmentService.get(id),
      resolveName: deps.resolveName,
      apiModel: deps.getWorkflow()?.apiModel,
    };
  }

  function profileIdOf(query: Record<string, unknown>): string | undefined {
    const value = query.profileId;
    return typeof value === "string" && value !== "" ? value : undefined;
  }

  return {
    deps,
    requireWorkflow,

    /** The target environments a profile can use: name, tier and base URL only, never variables (research R8). */
    listEnvironments() {
      return { environments: environmentService.list() };
    },
    createEnvironment(body: unknown) {
      return { environment: environmentService.create(parseTargetInput(body)) };
    },
    updateEnvironment(id: string, body: unknown) {
      return { environment: environmentService.update(id, parseTargetInput(body)) };
    },

    /**
     * `GET /analysis` (FR-005): the deterministic analysis of **every** operation in the loaded specification,
     * whatever operation selection the guided workflow holds. Needs a specification.
     */
    getAnalysis() {
      const workflow = requireWorkflow();
      const { sensitiveFields } = getSettings(getOwnerId());
      return {
        analysis: analyzeSecurity(workflow.apiModel, { configuredSensitiveFields: sensitiveFields }),
        configuredSensitiveFields: sensitiveFields,
        operationCount: workflow.apiModel.operations.length,
      };
    },

    /** `GET` and `PUT /settings`: the owner's configured sensitive field names. Retained work; no specification needed. */
    getSettings() {
      return getSettings(getOwnerId());
    },
    putSettings(body: unknown) {
      return putSettings(getOwnerId(), body, deps.now());
    },

    /** `GET /scope` (research R23): the default generation scope. Needs a specification. */
    getScope(): ReturnType<typeof getScope> {
      return getScope(scenarioContext());
    },

    /** `POST /scenarios/generate` (FR-018): deterministic generation over the chosen scope. Needs a specification. */
    generate(body: unknown) {
      const request = parseGenerateRequest(body);
      const raw = body as Record<string, unknown> | undefined;
      const profileId = typeof raw?.profileId === "string" ? raw.profileId : undefined;
      return generateScenarios(scenarioContext(profileId), request);
    },

    /** `GET /scenarios`: retained work, readable with no specification loaded (FR-004). */
    listScenarios(query: Record<string, unknown>) {
      return listScenarios(scenarioContext(profileIdOf(query)), parseListQuery(query));
    },

    /** `GET /scenarios/ids`: the explicit set a batch review names, never expanded by the server (FR-031). */
    listScenarioIds(query: Record<string, unknown>) {
      return listScenarioIds(scenarioContext(profileIdOf(query)), parseListQuery(query));
    },

    getScenario(id: string, query: Record<string, unknown>): ScenarioDetail {
      return getScenarioDetail(scenarioContext(profileIdOf(query)), id);
    },

    /** `PATCH /scenarios/:id`: a versioned edit. A material edit needs a specification (FR-030). */
    editScenario(id: string, body: unknown) {
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalidRequest("The request body must be an object.");
      const record = body as Record<string, unknown>;
      if (!Number.isInteger(record.expectedVersion)) throw invalidRequest("'expectedVersion' must be an integer.");
      if (typeof record.changes !== "object" || record.changes === null || Array.isArray(record.changes)) throw invalidRequest("'changes' must be an object.");
      if (record.note !== undefined && (typeof record.note !== "string" || record.note.length > 500)) {
        throw invalidRequest("'note' must be a string of at most 500 characters.");
      }

      const context = scenarioContext();
      const scenario = context.repo.getScenario(context.ownerId, id);
      if (!scenario) throw scenarioNotFound(id);
      const model = context.workflow?.apiModel;
      const result = editScenario(
        reviewContext(context),
        context.ownerId,
        id,
        { expectedVersion: record.expectedVersion as number, changes: record.changes as Record<string, unknown>, note: record.note as string | undefined },
        {
          apiModel: model,
          maxRepeat: deps.limits.ceilings.maxRepeat,
          basisHash: model ? basisHashes(model).get(scenario.operationKey) : undefined,
          specificationRevision: model ? specificationRevision(model) : undefined,
        },
      );
      return { ...result, scenario: getScenarioDetail(context, id) };
    },

    /** `POST /scenarios/review`: an explicit list of `{id, version}` items, each accepted or refused on its own. */
    review(body: unknown) {
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalidRequest("The request body must be an object.");
      const record = body as Record<string, unknown>;
      if (!(SECURITY_REVIEW_ACTIONS as readonly string[]).includes(String(record.action))) {
        throw invalidRequest(`'action' must be one of ${SECURITY_REVIEW_ACTIONS.join(", ")}.`);
      }
      const items = record.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 5000) {
        throw invalidRequest("'items' must be a list of 1 to 5000 {id, version} pairs. A filter is never accepted.");
      }
      for (const item of items) {
        const entry = item as Record<string, unknown> | null;
        if (typeof entry !== "object" || entry === null || typeof entry.id !== "string" || !Number.isInteger(entry.version)) {
          throw invalidRequest("Every item must be an object with a string 'id' and an integer 'version'.");
        }
      }
      if (record.reason !== undefined && typeof record.reason !== "string") throw invalidRequest("'reason' must be a string.");
      const confirmations = record.destructiveConfirmations;
      if (confirmations !== undefined && (!Array.isArray(confirmations) || confirmations.some((entry) => typeof entry !== "string"))) {
        throw invalidRequest("'destructiveConfirmations' must be an array of scenario ids.");
      }
      const context = scenarioContext();
      const outcomes = reviewItems(reviewContext(context), context.ownerId, {
        action: record.action as SecurityReviewAction,
        items: items as Array<{ id: string; version: number }>,
        reason: record.reason as string | undefined,
        destructiveConfirmations: confirmations as string[] | undefined,
      });
      return {
        applied: outcomes.filter((outcome) => outcome.applied),
        refused: outcomes.filter((outcome) => !outcome.applied),
      };
    },

    /** Profiles are session data. They need no specification, but validate scheme names against one when it is loaded. */
    listProfiles() {
      return { profiles: listProfiles(profileContext()) };
    },
    getProfile(id: string) {
      return getProfile(profileContext(), id);
    },
    createProfile(body: unknown) {
      return createProfile(profileContext(), body);
    },
    updateProfile(id: string, body: unknown) {
      return updateProfile(profileContext(), id, body);
    },
    deleteProfile(id: string): void {
      deleteProfile(profileContext(), id);
    },
    checkProfile(id: string) {
      return checkProfile(profileContext(), id);
    },
    /** Write-only: accepts a value and returns nothing. */
    putCredential(id: string, body: unknown): void {
      setCredential(profileContext(), id, body);
    },
    /** Which credentials are set. Never a value. */
    getCredentials(id: string) {
      return getCredentialStatus(profileContext(), id);
    },

    /** `GET /categories`: the registry with its taxonomy edition (FR-012 to FR-015). Static. */
    getCategories() {
      return {
        edition: TAXONOMY_EDITION,
        editionTitle: TAXONOMY_EDITIONS[TAXONOMY_EDITION].title,
        editionSource: TAXONOMY_EDITIONS[TAXONOMY_EDITION].source,
        taxonomy: TAXONOMY_EDITIONS[TAXONOMY_EDITION].entries,
        categories: listCategories(),
      };
    },
  };
}

export type SecurityLabService = ReturnType<typeof createSecurityLabService>;
