import { runnableJourneys, type ChainRunSnapshot, type ExpectedStatus, type PerformancePlan, type PerformanceThreshold } from "@apipilot/shared-domain";

/**
 * What the run aggregate and the findings read about a plan (specs/037-request-chain-performance
 * research R19): the steps by journey, with their method, expected statuses and the names of their
 * captures and checks. A legacy `PerformancePlan` and a request-chain run snapshot both reduce to it,
 * so one aggregate serves both. `layoutFromPlan` reproduces exactly what the aggregate read before.
 */
export interface RunLayoutStep {
  stepId: string;
  journeyId: string;
  /** The write-request key: the operation for a legacy step, the step id for a chain step. */
  operationKey: string;
  method: string;
  expected: ExpectedStatus[];
  captureNames: string[];
  /** AP-037: the step's checks, in order; empty for legacy steps. */
  checks: { id: string; kind: string }[];
}

export interface RunLayout {
  kind: "run-layout";
  journeys: { id: string; steps: RunLayoutStep[] }[];
  thresholds: PerformanceThreshold[];
  /** AP-037: Once before load steps in plan order; absent for legacy plans. */
  setupStepIds?: string[];
  /** AP-037: the plan's data sets by script index; absent for legacy plans. */
  dataSets?: { id: string; rowCount: number }[];
  /** AP-037: how findings name a step (method and name); absent for legacy plans, named by operation. */
  stepLabels?: Record<string, string>;
}

export function isRunLayout(value: PerformancePlan | RunLayout): value is RunLayout {
  return (value as RunLayout).kind === "run-layout";
}

/** The legacy plan's runnable journeys (AP-035 FR-025), as the aggregate always read them. */
export function layoutFromPlan(plan: PerformancePlan): RunLayout {
  return {
    kind: "run-layout",
    journeys: runnableJourneys(plan.journeys).map((journey) => ({
      id: journey.id,
      steps: journey.steps.map((step) => ({
        stepId: step.id,
        journeyId: journey.id,
        operationKey: step.operationKey,
        method: step.method,
        expected: step.expectedStatuses,
        captureNames: step.captures?.map((capture) => capture.name) ?? step.produces,
        checks: [],
      })),
    })),
    thresholds: plan.thresholds,
  };
}

/** A chain run: chains with at least one iteration step become journeys; setup steps are listed apart. */
export function layoutFromChainSnapshot(snapshot: ChainRunSnapshot): RunLayout {
  return {
    kind: "run-layout",
    journeys: snapshot.chains
      .map((chain) => ({
        id: chain.id,
        steps: chain.steps
          .filter((step) => step.runs !== "once-before-load")
          .map((step) => ({
            stepId: step.id,
            journeyId: chain.id,
            operationKey: step.id,
            method: step.method,
            expected: step.expectedStatuses.map((code): ExpectedStatus => ({ code, source: "user" })),
            captureNames: step.extractorNames,
            checks: step.checks.map((check) => ({ id: check.id, kind: check.kind })),
          })),
      }))
      .filter((chain) => chain.steps.length > 0),
    thresholds: snapshot.thresholds,
    setupStepIds: snapshot.chains.flatMap((chain) => chain.steps.filter((step) => step.runs === "once-before-load").map((step) => step.id)),
    dataSets: snapshot.dataSets.map((dataSet) => ({ id: dataSet.id, rowCount: dataSet.rowCount })),
    stepLabels: Object.fromEntries(snapshot.chains.flatMap((chain) => chain.steps.map((step) => [step.id, `${step.method} ${step.name}`]))),
  };
}
