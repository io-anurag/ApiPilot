import type { OmittedOperation, PerformanceJourney, TestGenerationWorkflow, UniqueValueField } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { buildJourneys } from "./buildJourneys";
import { operationKeyOf, planAuth, type AuthPlan, type PerformanceContext } from "./stepRequest";

/**
 * The derivation that seeds request-chain plans from a specification or the guided workflow
 * (specs/037-request-chain-performance FR-021, FR-023; research R16, R24). It is what remains of
 * AP-029's plan builder (specs/031-k6-performance-testing research D1, D5) after AP-037 phase two
 * retired the derived plans: pure over the context it is given, reading no values.
 */

/** The plan's inputs from the guided workflow. Requires Postman generation to be complete. */
export function contextFromWorkflow(workflow: TestGenerationWorkflow): PerformanceContext {
  if (!workflow.apiModel || !workflow.approvedTestModel) {
    throw new Error("A performance plan needs an analyzed specification and an approved test model.");
  }
  const approved = new Set(workflow.approvedWorkflowIds ?? []);
  return {
    apiModel: workflow.apiModel,
    approvedScenarios: workflow.approvedTestModel.scenarios,
    workflows: (workflow.dependencyAnalysis?.workflows ?? []).filter((candidate) => approved.has(candidate.id)),
    relationships: workflow.dependencyAnalysis?.graph.relationships ?? [],
    selectedOperationKeys: workflow.selectedOperationKeys,
    source: "guided",
  };
}

/**
 * AP-032 FR-003a (specs/032-quick-performance-test research Q5): the login operations the
 * chained-login token sources call, as the existing credential producers identify them. Nothing is
 * guessed by name or path.
 */
export function credentialProducerOperationKeys(auth: AuthPlan): string[] {
  const keys = [...auth.tokenSources.values()].flatMap((source) => (source.producerOperationKey ? [source.producerOperationKey] : []));
  return [...new Set(keys)].sort(compareCodeUnits);
}

/** The journeys a seed is made from, with the operations left out and the unique-value fields. */
export interface SeedPlan {
  journeys: PerformanceJourney[];
  omitted: OmittedOperation[];
  uniqueValueFields: UniqueValueField[];
}

/**
 * One journey per approved workflow and one single-step journey per other operation in scope. A
 * quick test's credential producers are left out, so a login is not seeded as a load step
 * (AP-032 FR-003a); a guided context leaves nothing out, as AP-029 did.
 */
export function buildPlan(context: PerformanceContext): SeedPlan {
  const auth = planAuth(context);
  const knownKeys = new Set(context.apiModel.operations.map((operation) => operationKeyOf(operation)));
  const excluded = context.source === "quick" ? credentialProducerOperationKeys(auth).filter((key) => knownKeys.has(key)) : [];
  const built = buildJourneys(context, auth, new Set(excluded));
  return { journeys: built.journeys, omitted: built.omitted, uniqueValueFields: built.uniqueValueFields };
}
