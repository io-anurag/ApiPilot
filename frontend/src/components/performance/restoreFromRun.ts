import type { PerformancePlan } from "@apipilot/shared-domain";
import type { PlanUpdate } from "../../services/performanceTestingClient";
import { journeysInputOf } from "./userJourneysViewModel";

/**
 * AP-029 FR-024b (amended 2026-09-30): rebuild a past run's plan settings on the current plan, so a
 * plan lost to a backend restart, a new upload or a reset can be run again. Only settings a run's
 * snapshot records are restored. Body and parameter edits are never in a snapshot (AP-033
 * research R10), so steps that had them are named instead.
 *
 * Two updates, because the backend checks every field against the plan as it is (planUpdate.ts):
 * the settings first, then the order, which must list exactly the journeys the settings leave.
 */
/** What restoring a run's settings did, as shown beside Run again. */
export interface RestoreOutcome {
  ok: boolean;
  message: string;
}

export type RestorePlan =
  | { ok: true; settings: PlanUpdate; notRestored: string[] }
  | { ok: false; reason: string };

export function restoreSettingsFromRun(runId: string, snapshot: PerformancePlan, current: PerformancePlan): RestorePlan {
  const run = runId.slice(0, 8);
  if (snapshot.source !== current.source || snapshot.upstreamFingerprint !== current.upstreamFingerprint) {
    return { ok: false, reason: `Run ${run} was built from a different specification or scenarios, so its settings cannot be restored.` };
  }
  if (snapshot.collection) return { ok: true, settings: collectionSettingsOf(snapshot, snapshot.collection), notRestored: [] };
  const snapshotSteps = snapshot.journeys.flatMap((journey) => journey.steps);
  const expectedStatuses: Record<string, string[]> = {};
  for (const step of snapshotSteps) {
    // Only codes the user set: sending codes marks them as the user's, so specification codes stay as they are.
    if (step.expectedStatuses.some((status) => status.source === "user")) expectedStatuses[step.id] = step.expectedStatuses.map((status) => status.code);
  }
  const settings: PlanUpdate = {
    excludedOperationKeys: [...snapshot.excludedOperationKeys],
    thinkTimeMs: snapshot.thinkTimeMs,
    loadProfile: { kind: snapshot.loadProfile.kind, stages: snapshot.loadProfile.stages.map((stage) => ({ ...stage })) },
    thresholds: snapshot.thresholds.map(({ scope, metric, comparator, limit }) => ({ scope, metric, comparator, limit })),
  };
  if (Object.keys(expectedStatuses).length > 0) settings.expectedStatuses = expectedStatuses;
  // AP-035 FR-028 (research R12): the run's journeys, captures and bindings, with their own ids. A
  // step whose operation or target no longer exists comes back incomplete or marked, never refused.
  const userJourneys = snapshot.userJourneys ?? [];
  if (userJourneys.length > 0 || (current.userJourneys ?? []).length > 0) {
    settings.userJourneys = journeysInputOf(userJourneys).map((journey, index) => ({ ...journey, nextStepNumber: userJourneys[index].nextStepNumber }));
    settings.nextUserJourneyNumber = snapshot.nextUserJourneyNumber ?? 1;
    settings.alsoStandalone = [...(snapshot.alsoStandalone ?? [])];
  }
  const notRestored = snapshotSteps.filter((step) => step.bodyEdited || step.parametersEdited).map((step) => step.operationKey);
  return { ok: true, settings, notRestored };
}

/**
 * AP-036 (FR-020): a collection plan's restorable settings. A collection plan takes no body,
 * parameter or journey edits, so its removed requests, the statuses and captures the engineer set,
 * and the load settings are all there is; the order follows with `restoreOrderFromRun`.
 */
function collectionSettingsOf(snapshot: PerformancePlan, collection: NonNullable<PerformancePlan["collection"]>): PlanUpdate {
  const requests = [
    ...snapshot.journeys.flatMap((journey) => journey.steps).map((step) => ({ id: step.id, expectedStatuses: step.expectedStatuses, captures: step.captures ?? [] })),
    ...collection.credentialRequests.map((request) => ({ id: request.stepId, expectedStatuses: request.expectedStatuses, captures: request.captures })),
  ];
  const expectedStatuses: Record<string, string[]> = {};
  const addedCaptures: NonNullable<PlanUpdate["addedCaptures"]> = {};
  for (const request of requests) {
    if (request.expectedStatuses.some((status) => status.source === "user")) expectedStatuses[request.id] = request.expectedStatuses.map((status) => status.code);
    const added = request.captures.filter((capture) => capture.origin?.kind === "user");
    if (added.length > 0) {
      addedCaptures[request.id] = added.map((capture) => ({
        name: capture.name,
        source: capture.source.kind === "body" ? { kind: "body", path: capture.source.path } : { kind: "header", name: capture.source.name },
      }));
    }
  }
  const addedBindings: NonNullable<PlanUpdate["addedBindings"]> = {};
  for (const binding of collection.addedBindings) {
    (addedBindings[binding.stepId] ??= []).push({ name: binding.name, captureStepId: binding.captureStepId, captureName: binding.captureName });
  }
  return {
    excludedRequestIds: [...collection.excludedRequestIds],
    thinkTimeMs: snapshot.thinkTimeMs,
    loadProfile: { kind: snapshot.loadProfile.kind, stages: snapshot.loadProfile.stages.map((stage) => ({ ...stage })) },
    thresholds: snapshot.thresholds.map(({ scope, metric, comparator, limit }) => ({ scope, metric, comparator, limit })),
    ...(Object.keys(expectedStatuses).length > 0 ? { expectedStatuses } : {}),
    ...(Object.keys(addedCaptures).length > 0 ? { addedCaptures } : {}),
    ...(Object.keys(addedBindings).length > 0 ? { addedBindings } : {}),
  };
}

/**
 * The run's journey and step order for the plan the settings produced, `null` when it already has
 * it, or a reason when that plan's journeys are not the run's.
 */
export function restoreOrderFromRun(runId: string, snapshot: PerformancePlan, restored: PerformancePlan): PlanUpdate | null | { reason: string } {
  const differ = { reason: `The plan's journeys differ from run ${runId.slice(0, 8)}'s, so its order was not restored.` };
  const wanted = snapshot.journeys.map((journey) => journey.id);
  const now = restored.journeys.map((journey) => journey.id);
  if (!sameMembers(wanted, now)) return differ;
  const update: PlanUpdate = {};
  if (!sameSequence(wanted, now)) update.journeyOrder = wanted;
  const byId = new Map(restored.journeys.map((journey) => [journey.id, journey]));
  const stepOrder: Record<string, string[]> = {};
  for (const journey of snapshot.journeys) {
    const order = journey.steps.map((step) => step.id);
    const current = byId.get(journey.id)?.steps.map((step) => step.id) ?? [];
    if (!sameMembers(order, current)) return differ;
    if (!sameSequence(order, current)) stepOrder[journey.id] = order;
  }
  if (Object.keys(stepOrder).length > 0) update.stepOrder = stepOrder;
  return Object.keys(update).length > 0 ? update : null;
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const members = new Set(b);
  return a.length === b.length && members.size === b.length && a.every((id) => members.has(id));
}

/**
 * AP-035 FR-028: the steps of the restored journeys that could not come back as they ran, because
 * their operation or a bound target no longer exists, named for the restore message.
 */
export function journeyStepsNotRestored(restored: PerformancePlan): string[] {
  const named: string[] = [];
  for (const journey of restored.journeys) {
    if (journey.source.kind !== "user") continue;
    for (const key of journey.incompleteReason?.missingOperationKeys ?? []) named.push(`${journey.source.name}: ${key}`);
    for (const step of journey.steps) {
      if (step.bindings?.some((binding) => binding.state === "target-missing")) named.push(`${journey.source.name}: ${step.operationKey}`);
    }
  }
  return named;
}
