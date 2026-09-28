import type {
  PerformancePlan,
  PerformanceThreshold,
  PerformanceThresholdMetric,
  PerformanceThresholdScope,
} from "@apipilot/shared-domain";
import { InvalidOrderError, InvalidThresholdError, UnknownOperationError } from "../errors";
import { assemblePlan, choicesOf } from "./buildPlan";
import { normalizeExpectedStatuses, prefillExpectedStatuses } from "./expectedStatuses";
import { canonicalJson, thresholdIdFor } from "./identifiers";
import { validateLoadProfile, validateThinkTime } from "./loadProfiles";
import { operationKeyOf, type PerformanceContext } from "./stepRequest";
import { validateJourneyOrder, validateStepOrder } from "./validateOrder";

/**
 * `PUT /plan` (contracts/performance-api.md). Every field sent is validated before any is
 * applied, so a rejected update leaves the plan exactly as it was. Fields not sent are unchanged.
 */
export class InvalidPlanUpdateError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidPlanUpdateError";
  }
}

const METRICS: ReadonlySet<string> = new Set(["p50", "p90", "p95", "p99", "error-rate"]);

function parseThreshold(raw: unknown, stepIds: ReadonlySet<string>): PerformanceThreshold {
  if (typeof raw !== "object" || raw === null) throw new InvalidThresholdError("Each threshold must be an object.");
  const record = raw as Record<string, unknown>;
  const scopeRecord = (record.scope ?? {}) as Record<string, unknown>;
  let scope: PerformanceThresholdScope;
  if (scopeRecord.kind === "run") scope = { kind: "run" };
  else if (scopeRecord.kind === "step" && typeof scopeRecord.stepId === "string" && stepIds.has(scopeRecord.stepId)) {
    scope = { kind: "step", stepId: scopeRecord.stepId };
  } else throw new InvalidThresholdError("A threshold applies to the whole run or to an existing step.");
  if (typeof record.metric !== "string" || !METRICS.has(record.metric)) {
    throw new InvalidThresholdError("A threshold's metric must be p50, p90, p95, p99 or error-rate.");
  }
  const metric = record.metric as PerformanceThresholdMetric;
  if (record.comparator !== "<=") throw new InvalidThresholdError("A threshold's comparator must be <=.");
  const limit = record.limit;
  if (typeof limit !== "number" || !Number.isFinite(limit)) throw new InvalidThresholdError("A threshold needs a numeric limit.");
  if (metric === "error-rate" ? limit < 0 || limit > 100 : limit <= 0) {
    throw new InvalidThresholdError(
      metric === "error-rate" ? "An error-rate limit is a percentage from 0 to 100." : "A latency limit must be over 0 ms.",
    );
  }
  return { id: thresholdIdFor(canonicalJson({ scope, metric, limit })), scope, metric, comparator: "<=", limit };
}

export function applyPlanUpdate(plan: PerformancePlan, update: unknown, context: PerformanceContext): PerformancePlan {
  if (typeof update !== "object" || update === null || Array.isArray(update)) {
    throw new InvalidPlanUpdateError("The request body must be an object.");
  }
  const body = update as Record<string, unknown>;
  const choices = choicesOf(plan);
  const steps = plan.journeys.flatMap((journey) => journey.steps);
  const stepIds = new Set(steps.map((step) => step.id));

  // AP-032 FR-022: the scope choice was removed. Refused rather than ignored, so a stale client is
  // told at once (research Q7).
  if ("scope" in body) throw new InvalidPlanUpdateError("The operations in scope follow the API review selection.");
  if ("excludedOperationKeys" in body) {
    const keys = body.excludedOperationKeys;
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
      throw new InvalidPlanUpdateError("excludedOperationKeys must be a list of operation keys.");
    }
    const known = new Set(context.apiModel.operations.map((operation) => operationKeyOf(operation)));
    const unknown = (keys as string[]).find((key) => !known.has(key));
    if (unknown !== undefined) throw new UnknownOperationError(unknown);
    choices.excludedOperationKeys = keys as string[];
  }
  if ("loadProfile" in body) choices.loadProfile = validateLoadProfile(body.loadProfile);
  if ("thinkTimeMs" in body) choices.thinkTimeMs = validateThinkTime(body.thinkTimeMs);
  if ("thresholds" in body) {
    if (!Array.isArray(body.thresholds)) throw new InvalidThresholdError("thresholds must be a list.");
    choices.thresholds = body.thresholds.map((raw) => parseThreshold(raw, stepIds));
  }
  if ("expectedStatuses" in body) {
    const lists = body.expectedStatuses;
    if (typeof lists !== "object" || lists === null || Array.isArray(lists)) {
      throw new InvalidPlanUpdateError("expectedStatuses must map step ids to lists of codes.");
    }
    const operations = new Map(context.apiModel.operations.map((operation) => [operationKeyOf(operation), operation]));
    for (const [stepId, codes] of Object.entries(lists as Record<string, unknown>)) {
      const step = steps.find((candidate) => candidate.id === stepId);
      const operation = step ? operations.get(step.operationKey) : undefined;
      const prefill = operation ? prefillExpectedStatuses(operation) : [];
      if (!step) normalizeExpectedStatuses(stepId, [], prefill);
      choices.expectedStatusCodes.set(stepId, normalizeExpectedStatuses(stepId, codes, prefill).map((status) => status.code));
    }
  }
  if ("stepOrder" in body) {
    const orders = body.stepOrder;
    if (typeof orders !== "object" || orders === null || Array.isArray(orders)) {
      throw new InvalidOrderError("stepOrder must map journey ids to step ids.");
    }
    for (const [journeyId, order] of Object.entries(orders as Record<string, unknown>)) {
      const journey = plan.journeys.find((candidate) => candidate.id === journeyId);
      if (!journey) throw new InvalidOrderError(`'${journeyId}' is not a journey in this plan.`);
      choices.stepOrder!.set(journeyId, validateStepOrder(journey, order));
    }
  }
  if ("journeyOrder" in body) choices.journeyOrder = validateJourneyOrder(plan, body.journeyOrder);

  return assemblePlan(context, choices);
}
