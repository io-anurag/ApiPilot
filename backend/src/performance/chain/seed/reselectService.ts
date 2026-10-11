import type { Chain, ChainPlan, ChainStep, ReselectEditedRemoval, ReselectMode, ReselectOutcome, SeedingReportItem } from "@apipilot/shared-domain";
import { isEngineerChain } from "@apipilot/shared-domain";
import { PlanSourceUnavailableError } from "../../../api/performanceHttp";
import { getSessionId } from "../../../session/sessionContext";
import { UnknownOperationKeyError } from "../../../testGenerationWorkflow/errors";
import { normalizeOperationSelection } from "../../../testGenerationWorkflow/operationSelection";
import { getChainPlanRepository } from "../../../persistence/chainPlanRepository";
import { EditedStepsWouldBeRemovedError, InvalidChainPlanError, PlanRevisionConflictError, PlanSourceChangedError, PlanSourceNotSupportedError } from "../../errors";
import { contextFromQuickTest, getQuickTest } from "../../quick/quickTestStore";
import { getPlan, viewOf } from "../chainPlanStore";
import { withFingerprint } from "../savePlan";
import { assembleSeededPlan } from "./assembleSeededPlan";
import { seedFromSpecification } from "./seedFromSpecification";

/**
 * Applying a new operation selection to a plan seeded from a specification (specs/047-unified-performance-tab
 * FR-015 to FR-017, contracts/reselect-api.md). It narrows the rule that a plan is never re-derived
 * (specs/037 FR-026) to the operations the engineer selects: only newly selected operations are seeded, and
 * a step the engineer kept is never rewritten. `merge` removes the deselected steps, appends the newly selected
 * ones and keeps everything else; `reset` rebuilds the chains from the selection. Data sets, load profile,
 * environment, name and runs are never touched. Deterministic: the same plan and selection always give the same
 * result, with ids taken from the plan's own counters, never reused. Nothing is sent and nothing is run.
 */

const SCHEME_PREFIX = "securityScheme:";
const CREDENTIALS_CHAIN = "Credentials";

const operationKeyOf = (step: ChainStep): string | null => (step.source.kind === "operation" ? step.source.operationKey : null);
const isRealOperation = (key: string) => !key.startsWith(SCHEME_PREFIX);
const realKeys = (keys: Iterable<string>) => [...keys].filter(isRealOperation);
const byText = (a: string, b: string) => Number(a > b) - Number(a < b);

function keysOf(plan: Pick<ChainPlan, "chains">): Set<string> {
  const keys = new Set<string>();
  for (const step of plan.chains.flatMap((chain) => chain.steps)) {
    const key = operationKeyOf(step);
    if (key !== null) keys.add(key);
  }
  return keys;
}

/** Hands out ids from the plan's counters, so an id is never reused (specs/037 research R2). */
class Ids {
  /** Where each freshly seeded step went, so report items can follow it. */
  readonly moved = new Map<string, string>();

  constructor(
    public chain: number,
    public step: number,
    public item: number,
  ) {}

  /** A copy of a freshly seeded step with new step and extractor ids; its seed digest is kept, so it counts as unchanged. */
  stepCopy(step: ChainStep): ChainStep {
    const copy = { ...step, id: `s${this.step++}`, extractors: step.extractors.map((extractor) => ({ ...extractor, id: `x${this.item++}` })) };
    this.moved.set(step.id, copy.id);
    return copy;
  }

  /** A new chain of the wanted fresh steps, or `null` when none of them is wanted. */
  chainCopy(chain: Chain, wanted: (step: ChainStep) => boolean): Chain | null {
    const steps = chain.steps.filter(wanted).map((step) => this.stepCopy(step));
    return steps.length === 0 ? null : { id: `c${this.chain++}`, name: chain.name, steps };
  }
}

export interface ReselectResult {
  plan: ChainPlan;
  added: string[];
  removed: string[];
  keptEdited: string[];
}

/** The edited steps a merge would remove (FR-016): a step is edited when its content differs from its seed. */
function editedRemovals(stored: ChainPlan, removedKeys: ReadonlySet<string>): ReselectEditedRemoval[] {
  const edited: ReselectEditedRemoval[] = [];
  for (const chain of stored.chains) {
    for (const step of chain.steps) {
      const key = operationKeyOf(step);
      if (key !== null && removedKeys.has(key) && step.changed) edited.push({ chainId: chain.id, stepId: step.id, stepName: step.name, operationKey: key, reasons: ["step-changed"] });
    }
  }
  return edited;
}

/** The operations kept by the new selection whose step the engineer has edited. */
function keptEditedKeys(stored: ChainPlan, newKeys: ReadonlySet<string>): string[] {
  const steps = stored.chains.flatMap((chain) => chain.steps);
  return realKeys([...newKeys].filter((key) => steps.some((step) => step.changed && operationKeyOf(step) === key)));
}

/** The stored chains without the removed steps; a chain only seeding filled goes with them, one the engineer made or still uses stays. */
function withoutRemoved(stored: ChainPlan, removedKeys: ReadonlySet<string>): { chains: Chain[]; removedStepIds: Set<string> } {
  const removedStepIds = new Set<string>();
  const chains: Chain[] = [];
  for (const chain of stored.chains) {
    const steps = chain.steps.filter((step) => {
      const key = operationKeyOf(step);
      const drop = key !== null && removedKeys.has(key);
      if (drop) removedStepIds.add(step.id);
      return !drop;
    });
    if (steps.length === 0 && chain.steps.length > 0 && !isEngineerChain(chain)) continue;
    chains.push(steps.length === chain.steps.length ? chain : { ...chain, steps });
  }
  return { chains, removedStepIds };
}

/** Newly selected steps: a token step joins the Credentials chain (a new one goes first, as seeding puts it); the rest are appended. */
function withAdded(chains: Chain[], fresh: ChainPlan, addedKeys: ReadonlySet<string>, ids: Ids): Chain[] {
  const wanted = (step: ChainStep) => {
    const key = operationKeyOf(step);
    return key !== null && addedKeys.has(key);
  };
  const result = [...chains];
  const credentialSteps: ChainStep[] = [];
  const appended: Chain[] = [];
  for (const chain of fresh.chains) {
    if (chain.name === CREDENTIALS_CHAIN) {
      credentialSteps.push(...chain.steps.filter(wanted).map((step) => ids.stepCopy(step)));
      continue;
    }
    const copy = ids.chainCopy(chain, wanted);
    if (copy) appended.push(copy);
  }
  if (credentialSteps.length > 0) {
    const existing = result.findIndex((chain) => chain.name === CREDENTIALS_CHAIN && chain.steps.some((step) => operationKeyOf(step) !== null));
    if (existing >= 0) result[existing] = { ...result[existing], steps: [...result[existing].steps, ...credentialSteps] };
    else result.unshift({ id: `c${ids.chain++}`, name: CREDENTIALS_CHAIN, steps: credentialSteps });
  }
  return [...result, ...appended];
}

/** Report items that follow the steps they describe; an item for a removed step stays, with no step. */
function reportItems(source: readonly SeedingReportItem[], ids: Ids, keep: (item: SeedingReportItem) => boolean): SeedingReportItem[] {
  return source.filter(keep).map((item) => ({ ...item, stepId: item.stepId ? (ids.moved.get(item.stepId) ?? null) : null }));
}

function mergeChains(stored: ChainPlan, fresh: ChainPlan, addedKeys: ReadonlySet<string>, removedKeys: ReadonlySet<string>, confirm: boolean, ids: Ids) {
  const edited = editedRemovals(stored, removedKeys);
  if (edited.length > 0 && !confirm) throw new EditedStepsWouldBeRemovedError(edited);
  const kept = withoutRemoved(stored, removedKeys);
  const chains = withAdded(kept.chains, fresh, addedKeys, ids);
  const earlier = (stored.seedingReport?.items ?? []).map((item) => (item.stepId && kept.removedStepIds.has(item.stepId) ? { ...item, stepId: null } : item));
  const added = reportItems(fresh.seedingReport?.items ?? [], ids, (item) => (item.stepId ? ids.moved.has(item.stepId) : addedKeys.has(item.sourceLabel)));
  return { chains, items: [...earlier, ...added] };
}

function resetChains(fresh: ChainPlan, ids: Ids) {
  const chains = fresh.chains.map((chain) => ids.chainCopy(chain, () => true)).filter((chain): chain is Chain => chain !== null);
  return { chains, items: reportItems(fresh.seedingReport?.items ?? [], ids, () => true) };
}

/** Run-scoped thresholds stay; a threshold on a step that is gone goes with it. */
function keptThresholds(stored: ChainPlan, chains: readonly Chain[]): ChainPlan["thresholds"] {
  const live = new Set(chains.flatMap((chain) => chain.steps.map((step) => step.id)));
  return stored.thresholds.filter((threshold) => threshold.scope.kind !== "step" || live.has(threshold.scope.stepId));
}

/** Pure core: the stored plan and the same specification seeded with the new selection. */
export function applyReselect(stored: ChainPlan, fresh: ChainPlan, mode: ReselectMode, confirmRemoveEdited: boolean, now: string): ReselectResult {
  const oldKeys = keysOf(stored);
  const newKeys = keysOf(fresh);
  const addedKeys = new Set([...newKeys].filter((key) => !oldKeys.has(key)));
  const removedKeys = new Set([...oldKeys].filter((key) => !newKeys.has(key)));
  const ids = new Ids(stored.nextChainNumber, stored.nextStepNumber, stored.nextItemNumber);

  const rebuilt = mode === "reset" ? resetChains(fresh, ids) : mergeChains(stored, fresh, addedKeys, removedKeys, confirmRemoveEdited, ids);
  // A plan always has one chain; an empty one is made when nothing is left.
  const chains = rebuilt.chains.length > 0 ? rebuilt.chains : [{ id: `c${ids.chain++}`, name: `Chain ${ids.chain - 1}`, steps: [] }];

  const plan = withFingerprint({
    ...stored,
    chains,
    thresholds: keptThresholds(stored, chains),
    secretNames: [...new Set([...stored.secretNames, ...fresh.secretNames])].sort(byText),
    seedingReport: stored.seedingReport ? { ...stored.seedingReport, ...(mode === "reset" ? { seededAt: now } : {}), items: rebuilt.items } : null,
    nextChainNumber: ids.chain,
    nextStepNumber: ids.step,
    nextItemNumber: ids.item,
    revision: stored.revision + 1,
    updatedAt: now,
  });
  return { plan, added: realKeys(addedKeys), removed: realKeys(removedKeys), keptEdited: mode === "merge" ? keptEditedKeys(stored, newKeys) : [] };
}

function requestOf(raw: unknown): { revision: number; mode: ReselectMode; keys: string[]; confirm: boolean } {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (typeof body.revision !== "number" || !Number.isInteger(body.revision)) throw new InvalidChainPlanError("revision", "The plan revision you were looking at is required.");
  if (body.mode !== "merge" && body.mode !== "reset") throw new InvalidChainPlanError("mode", "The mode is merge or reset.");
  const keys = body.selectedOperationKeys;
  if (!Array.isArray(keys) || keys.length === 0 || !keys.every((key) => typeof key === "string")) {
    throw new InvalidChainPlanError("selectedOperationKeys", "Select at least one operation, each as \"METHOD /path\".");
  }
  if (body.confirmRemoveEdited !== undefined && typeof body.confirmRemoveEdited !== "boolean") throw new InvalidChainPlanError("confirmRemoveEdited", "confirmRemoveEdited is true or false.");
  return { revision: body.revision, mode: body.mode, keys: keys as string[], confirm: body.confirmRemoveEdited === true };
}

/** `POST /api/chain-plans/:planId/reselect`: the stored plan at `revision`, or a typed refusal that changes nothing. */
export function reselectPlan(planId: string, rawRequest: unknown, now: string): ReselectOutcome {
  const request = requestOf(rawRequest);
  const stored = getPlan(planId);
  if (request.revision !== stored.revision) throw new PlanRevisionConflictError(planId);
  const origin = stored.seedingReport?.source;
  if (origin?.kind !== "specification") throw new PlanSourceNotSupportedError();
  const test = getQuickTest();
  if (!test) throw new PlanSourceUnavailableError(404, "quick_test_not_found", "Upload a specification in Performance first.");
  if (test.specification.filename !== origin.filename) throw new PlanSourceChangedError(origin.filename, test.specification.filename);

  let selected: string[] | undefined;
  try {
    selected = normalizeOperationSelection(test.apiModel, request.keys);
  } catch (error) {
    if (error instanceof UnknownOperationKeyError) throw new InvalidChainPlanError("selectedOperationKeys", error.message);
    throw error;
  }
  const seed = seedFromSpecification({ ...contextFromQuickTest(test), selectedOperationKeys: selected }, test.specification.filename, stored.name, now);
  const fresh = assembleSeededPlan({ ...seed, environment: null }).plan;

  const result = applyReselect(stored, fresh, request.mode, request.confirm, now);
  const saved = getChainPlanRepository().save(getSessionId(), result.plan, stored.revision);
  if (!saved.ok) throw new PlanRevisionConflictError(planId);
  return { ...viewOf(getPlan(planId)), added: result.added, removed: result.removed, keptEdited: result.keptEdited };
}
