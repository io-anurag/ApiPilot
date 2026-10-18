import type {
  ApiModel,
  AppliedGenerationScope,
  ExecutionStatus,
  GenerationReply,
  GenerationScope,
  ScenarioDerivedFlags,
  ScenarioDetail,
  ScenarioListItem,
  ScenarioListReply,
  ScenarioVersionSummary,
  SecurityProfile,
  SecurityReviewState,
  SecurityScenarioVersion,
  Severity,
  TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import { GENERATABLE_CATEGORY_IDS } from "@apipilot/shared-domain";
import { specificationRevision } from "../../apiCoverage/specRevision";
import type { ScenarioQuery, SecurityScenarioRepository, StoredScenario } from "../../persistence/securityScenarioRepository";
import { operationKeyOf } from "../analysis/effectiveSecurity";
import { basisHashes } from "../analysis/securityBasisHash";
import type { SecurityLabLimits } from "../config";
import { SecurityLabError, invalidRequest, noSpecification, retentionLimitReached, scenarioNotFound } from "../errors";
import { isGeneratableCategoryId } from "../registry/categories";
import { assessmentOf } from "../retention/assessmentKey";
import { hasLiveApproval } from "../review/reviewService";
import { contentHashOf } from "./scenarioIdentity";
import { generateSecurityScenarios } from "./generateSecurityScenarios";
import { evaluatePrerequisites, type PrerequisiteContext } from "./prerequisites";

/**
 * Persistence and derivation around deterministic generation (specs/057 FR-018, FR-029, research R3, R22, R23).
 * Generation never overwrites a version: a scenario whose content or whose operation basis changed gains a new
 * version that needs review, and an engineer's own edit is never replaced unless the basis changed. Staleness,
 * orphaning, prerequisites and executability are **derived on every read** from the model currently loaded and the
 * selected profile; none of them is stored, so nothing stale is ever trusted.
 */

export interface ScenarioContext {
  readonly ownerId: string;
  readonly actor: string;
  readonly now: () => Date;
  readonly limits: SecurityLabLimits;
  readonly repo: SecurityScenarioRepository;
  readonly workflow?: TestGenerationWorkflow;
  /** The profile selected for this request, if any (session data). */
  readonly profile?: SecurityProfile;
  readonly hasCredential: PrerequisiteContext["hasCredential"];
  readonly configuredSensitiveFields: readonly string[];
}

function apiModelOf(context: ScenarioContext): ApiModel | undefined {
  return context.workflow?.apiModel;
}

function requireModel(context: ScenarioContext): ApiModel {
  const model = apiModelOf(context);
  if (!model) throw noSpecification();
  return model;
}

// ---------------------------------------------------------------------------------------------
// Scope (research R23)
// ---------------------------------------------------------------------------------------------

export interface ScopeInfo {
  readonly mode: "selection" | "all";
  readonly selectedCount: number;
  readonly totalCount: number;
}

/** The default generation scope: the guided workflow's selection, or every operation when none was made. */
export function getScope(context: ScenarioContext): ScopeInfo {
  const model = requireModel(context);
  const selected = context.workflow?.selectedOperationKeys;
  const known = new Set(model.operations.map(operationKeyOf));
  const inModel = selected?.filter((key) => known.has(key)) ?? [];
  const hasSelection = selected !== undefined && inModel.length > 0;
  return { mode: hasSelection ? "selection" : "all", selectedCount: hasSelection ? inModel.length : known.size, totalCount: known.size };
}

export function resolveScope(context: ScenarioContext, requested: GenerationScope | undefined): { scope: ReadonlySet<string> | "all"; applied: AppliedGenerationScope } {
  const model = requireModel(context);
  const known = new Set(model.operations.map(operationKeyOf));
  const mode = requested?.mode ?? "selection";
  if (mode === "all") return { scope: "all", applied: { mode: "all", included: known.size, excluded: 0 } };

  if (mode === "custom") {
    const keys = requested?.operationKeys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.some((key) => typeof key !== "string")) {
      throw invalidRequest("A custom scope needs 'operationKeys': a non-empty array of operation keys such as \"GET /orders\".");
    }
    const chosen = new Set(keys.filter((key) => known.has(key)));
    return { scope: chosen, applied: { mode: "custom", included: chosen.size, excluded: known.size - chosen.size } };
  }

  const info = getScope(context);
  if (info.mode === "all") return { scope: "all", applied: { mode: "all", included: known.size, excluded: 0 } };
  const chosen = new Set((context.workflow?.selectedOperationKeys ?? []).filter((key) => known.has(key)));
  return { scope: chosen, applied: { mode: "selection", included: chosen.size, excluded: known.size - chosen.size } };
}

// ---------------------------------------------------------------------------------------------
// Derived flags and list items
// ---------------------------------------------------------------------------------------------

export function flagResolver(context: ScenarioContext): (scenario: StoredScenario, version: SecurityScenarioVersion) => ScenarioDerivedFlags {
  const model = apiModelOf(context);
  const basis = model ? basisHashes(model) : undefined;
  const prerequisiteContext: PrerequisiteContext = { profile: context.profile, hasCredential: context.hasCredential };

  return (scenario, version) => {
    const key = version.content.operationKey;
    const specificationNotLoaded = !model;
    const orphaned = !!basis && !basis.has(key);
    const stale = !!basis && basis.has(key) && basis.get(key) !== version.securityBasisHash;
    const prerequisites = evaluatePrerequisites(version.content.prerequisites, prerequisiteContext);
    const blocked = prerequisites.some((entry) => entry.state !== "met");
    const profile = context.profile;
    const live = scenario.reviewState === "approved" && hasLiveApproval(version);
    const permitted = !!profile && profile.permittedCategories.includes(version.content.categoryId);
    const destructiveOk = !version.content.destructive.flag || profile?.destructivePermitted === true;
    return {
      specificationNotLoaded,
      stale: !specificationNotLoaded && stale,
      orphaned: !specificationNotLoaded && orphaned,
      blocked,
      executable: !!profile && live && !specificationNotLoaded && !orphaned && !stale && !blocked && permitted && destructiveOk,
    };
  };
}

function toListItem(context: ScenarioContext, scenario: StoredScenario, version: SecurityScenarioVersion, flags: ScenarioDerivedFlags): ScenarioListItem {
  const prerequisites = evaluatePrerequisites(version.content.prerequisites, { profile: context.profile, hasCredential: context.hasCredential });
  return {
    id: scenario.id,
    assessmentKey: scenario.assessmentKey,
    assessmentLabel: scenario.assessmentLabel,
    reviewState: scenario.reviewState,
    executionStatus: scenario.executionStatus,
    origin: scenario.origin,
    currentVersion: scenario.currentVersion,
    title: scenario.title,
    operationKey: scenario.operationKey,
    categoryId: scenario.categoryId,
    severity: scenario.severity,
    destructive: scenario.destructive,
    flags,
    prerequisites: { total: prerequisites.length, met: prerequisites.filter((entry) => entry.state === "met").length },
  };
}

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------

export interface GenerateRequest {
  scope?: GenerationScope;
  categories?: string[];
}

export function parseGenerateRequest(body: unknown): GenerateRequest {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw invalidRequest("The request body must be an object.");
  const record = body as Record<string, unknown>;
  const request: GenerateRequest = {};
  if (record.scope !== undefined) {
    const scope = record.scope as Record<string, unknown> | null;
    if (typeof scope !== "object" || scope === null || !["selection", "all", "custom"].includes(String(scope.mode))) {
      throw invalidRequest("'scope.mode' must be \"selection\", \"all\" or \"custom\".");
    }
    request.scope = { mode: scope.mode as GenerationScope["mode"], ...(scope.operationKeys !== undefined ? { operationKeys: scope.operationKeys as string[] } : {}) };
  }
  if (record.categories !== undefined) {
    if (!Array.isArray(record.categories) || record.categories.some((entry) => typeof entry !== "string")) {
      throw invalidRequest("'categories' must be an array of category ids.");
    }
    for (const category of record.categories as string[]) {
      if (!isGeneratableCategoryId(category)) {
        throw new SecurityLabError("category_not_generatable", `'${category}' is not a category that can have scenarios generated. Generatable categories are ${GENERATABLE_CATEGORY_IDS.join(", ")}.`);
      }
    }
    request.categories = record.categories as string[];
  }
  return request;
}

export function generateScenarios(context: ScenarioContext, request: GenerateRequest): GenerationReply {
  const model = requireModel(context);
  const workflow = context.workflow as TestGenerationWorkflow;
  const { scope, applied } = resolveScope(context, request.scope);
  const result = generateSecurityScenarios({
    apiModel: model,
    scope,
    limits: context.limits,
    profile: context.profile,
    categories: request.categories as never,
    configuredSensitiveFields: context.configuredSensitiveFields,
  });

  const { repo, ownerId } = context;
  const newIds = result.scenarios.filter((scenario) => !repo.getScenario(ownerId, scenario.id));
  if (repo.countByOwner(ownerId) + newIds.length > context.limits.retention.maxScenarios) {
    throw retentionLimitReached("scenarios", context.limits.retention.maxScenarios);
  }

  const assessment = assessmentOf(model, workflow.specificationFilename);
  const revision = specificationRevision(model);
  const basis = basisHashes(model);
  const now = context.now().toISOString();
  let created = 0;
  let kept = 0;
  let newVersions = 0;

  for (const generated of result.scenarios) {
    const key = generated.content.operationKey;
    const basisHash = basis.get(key) ?? "";
    const contentHash = contentHashOf(generated.content);
    const existing = repo.getScenario(ownerId, generated.id);

    if (!existing) {
      repo.insertScenario(
        {
          id: generated.id,
          ownerId,
          assessmentKey: assessment.key,
          assessmentLabel: assessment.label,
          currentVersion: 1,
          reviewState: "draft",
          executionStatus: "not_run",
          origin: "rule",
          createdAt: now,
        },
        { operationKey: key, categoryId: generated.content.categoryId, severity: generated.content.suggestedSeverity, destructive: generated.content.destructive.flag, title: generated.content.title },
        now,
      );
      repo.insertVersion(ownerId, {
        scenarioId: generated.id,
        version: 1,
        contentHash,
        specificationRevision: revision,
        securityBasisHash: basisHash,
        content: generated.content,
        author: "generator",
        createdAt: now,
        materialChange: false,
      });
      created += 1;
      continue;
    }

    const current = repo.getVersion(ownerId, generated.id, existing.currentVersion);
    const sameBasis = current?.securityBasisHash === basisHash;
    const sameContent = current !== undefined && contentHashOf(current.content) === contentHash;
    const editedByPerson = current?.author === "user";
    if (current && sameBasis && (sameContent || editedByPerson)) {
      kept += 1;
      continue;
    }

    // The content or the operation basis changed: a new version that needs review, never a silent overwrite.
    const version = existing.currentVersion + 1;
    repo.insertVersion(ownerId, {
      scenarioId: generated.id,
      version,
      contentHash,
      specificationRevision: revision,
      securityBasisHash: basisHash,
      content: generated.content,
      author: "generator",
      createdAt: now,
      editNote: sameBasis ? "Regenerated: the generated content changed." : "Regenerated: the operation changed since the earlier version.",
      materialChange: !sameContent,
    });
    let reviewState: SecurityReviewState = existing.reviewState === "draft" ? "draft" : "in_review";
    if (existing.reviewState === "rejected") reviewState = "rejected";
    repo.updateHead(ownerId, generated.id, {
      currentVersion: version,
      reviewState,
      executionStatus: "not_run",
      title: generated.content.title,
      severity: generated.content.suggestedSeverity,
      destructive: generated.content.destructive.flag,
      updatedAt: now,
    });
    newVersions += 1;
  }

  return {
    scope: applied,
    created,
    kept,
    newVersions,
    rejected: result.rejected,
    omittedByCap: result.omittedByCap.map((entry) => ({ operationKey: entry.operationKey, categoryId: entry.categoryId, omitted: entry.omitted })),
    notes: result.notes.map((note) => ({ categoryId: note.categoryId, ...(note.operationKey ? { operationKey: note.operationKey } : {}), reason: note.reason })),
  };
}

// ---------------------------------------------------------------------------------------------
// Listing and detail
// ---------------------------------------------------------------------------------------------

export type FlagFilter = "stale" | "orphaned" | "blocked" | "executable" | "specification_not_loaded";

export interface ListQuery {
  q?: string;
  operation?: string;
  category?: string;
  severity?: Severity;
  reviewState?: SecurityReviewState;
  executionStatus?: ExecutionStatus;
  assessment?: string;
  flag?: FlagFilter;
  page?: number;
  pageSize?: number;
}

const FLAG_FILTERS: readonly FlagFilter[] = ["stale", "orphaned", "blocked", "executable", "specification_not_loaded"];
const MAX_PAGE_SIZE = 100;
const MAX_IDS = 5_000;

function toDbFilter(query: ListQuery): ScenarioQuery {
  return {
    ...(query.assessment ? { assessmentKey: query.assessment } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.operation ? { operationKey: query.operation } : {}),
    ...(query.category ? { categoryId: query.category } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.reviewState ? { reviewState: query.reviewState } : {}),
    ...(query.executionStatus ? { executionStatus: query.executionStatus } : {}),
  };
}

function matchesFlag(flags: ScenarioDerivedFlags, flag: FlagFilter): boolean {
  if (flag === "specification_not_loaded") return flags.specificationNotLoaded;
  return flags[flag];
}

export function parseListQuery(raw: Record<string, unknown>): ListQuery {
  const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);
  const query: ListQuery = {
    q: text(raw.q),
    operation: text(raw.operation),
    category: text(raw.category),
    assessment: text(raw.assessment),
  };
  const severity = text(raw.severity);
  if (severity) {
    if (!["info", "low", "medium", "high", "critical"].includes(severity)) throw invalidRequest(`'severity' must be one of info, low, medium, high, critical.`);
    query.severity = severity as Severity;
  }
  const reviewState = text(raw.reviewState);
  if (reviewState) {
    if (!["draft", "in_review", "approved", "rejected"].includes(reviewState)) throw invalidRequest(`'reviewState' must be one of draft, in_review, approved, rejected.`);
    query.reviewState = reviewState as SecurityReviewState;
  }
  const executionStatus = text(raw.executionStatus);
  if (executionStatus) {
    if (!["not_run", "executed", "evaluated"].includes(executionStatus)) throw invalidRequest(`'executionStatus' must be one of not_run, executed, evaluated.`);
    query.executionStatus = executionStatus as ExecutionStatus;
  }
  const flag = text(raw.flag);
  if (flag) {
    if (!(FLAG_FILTERS as readonly string[]).includes(flag)) throw invalidRequest(`'flag' must be one of ${FLAG_FILTERS.join(", ")}.`);
    query.flag = flag as FlagFilter;
  }
  const page = text(raw.page);
  const pageSize = text(raw.pageSize);
  if (page !== undefined) {
    if (!/^\d+$/.test(page) || Number(page) < 1) throw invalidRequest("'page' must be a positive integer.");
    query.page = Number(page);
  }
  if (pageSize !== undefined) {
    if (!/^\d+$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) throw invalidRequest(`'pageSize' must be between 1 and ${MAX_PAGE_SIZE}.`);
    query.pageSize = Number(pageSize);
  }
  return query;
}

function tally<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function listScenarios(context: ScenarioContext, query: ListQuery): ScenarioListReply {
  const { repo, ownerId } = context;
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const heads = repo.listHeads(ownerId, toDbFilter(query));
  const resolve = flagResolver(context);

  const needsFlags = query.flag !== undefined;
  const versionOf = (scenario: StoredScenario) => repo.getVersion(ownerId, scenario.id, scenario.currentVersion);

  let matching = heads;
  const flagsById = new Map<string, ScenarioDerivedFlags>();
  if (needsFlags) {
    matching = heads.filter((scenario) => {
      const version = versionOf(scenario);
      if (!version) return false;
      const flags = resolve(scenario, version);
      flagsById.set(scenario.id, flags);
      return matchesFlag(flags, query.flag as FlagFilter);
    });
  }

  const slice = matching.slice((page - 1) * pageSize, page * pageSize);
  const items: ScenarioListItem[] = [];
  for (const scenario of slice) {
    const version = versionOf(scenario);
    if (!version) continue;
    items.push(toListItem(context, scenario, version, flagsById.get(scenario.id) ?? resolve(scenario, version)));
  }

  return {
    items,
    total: matching.length,
    page,
    pageSize,
    counts: {
      byReviewState: tally(heads.map((scenario) => scenario.reviewState)),
      byExecutionStatus: tally(heads.map((scenario) => scenario.executionStatus)),
      byCategory: tally(heads.map((scenario) => scenario.categoryId)),
      bySeverity: tally(heads.map((scenario) => scenario.severity)),
    },
  };
}

export function listScenarioIds(context: ScenarioContext, query: ListQuery): { items: Array<{ id: string; version: number }>; total: number; capped: boolean } {
  const { repo, ownerId } = context;
  const heads = repo.listHeads(ownerId, toDbFilter(query));
  let matching = heads;
  if (query.flag !== undefined) {
    const resolve = flagResolver(context);
    matching = heads.filter((scenario) => {
      const version = repo.getVersion(ownerId, scenario.id, scenario.currentVersion);
      return version !== undefined && matchesFlag(resolve(scenario, version), query.flag as FlagFilter);
    });
  }
  const capped = matching.length > MAX_IDS;
  return {
    items: matching.slice(0, MAX_IDS).map((scenario) => ({ id: scenario.id, version: scenario.currentVersion })),
    total: matching.length,
    capped,
  };
}

function summarize(version: SecurityScenarioVersion): ScenarioVersionSummary {
  return {
    version: version.version,
    author: version.author,
    createdAt: version.createdAt,
    ...(version.editNote ? { editNote: version.editNote } : {}),
    materialChange: version.materialChange,
    contentHash: version.contentHash,
    specificationRevision: version.specificationRevision,
    ...(version.approval ? { approval: version.approval } : {}),
    ...(version.rejection ? { rejection: version.rejection } : {}),
  };
}

export function getScenarioDetail(context: ScenarioContext, id: string): ScenarioDetail {
  const { repo, ownerId } = context;
  const scenario = repo.getScenario(ownerId, id);
  if (!scenario) throw scenarioNotFound(id);
  const versions = repo.listVersions(ownerId, id);
  const current = versions.find((entry) => entry.version === scenario.currentVersion);
  if (!current) throw scenarioNotFound(id);
  const flags = flagResolver(context)(scenario, current);
  return {
    scenario: toListItem(context, scenario, current, flags),
    content: {
      ...current.content,
      prerequisites: evaluatePrerequisites(current.content.prerequisites, { profile: context.profile, hasCredential: context.hasCredential }),
    },
    versions: versions.map(summarize),
  };
}
