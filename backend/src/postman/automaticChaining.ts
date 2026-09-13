import type {
  ApiDependencyGraph,
  ApiDependencyRelationship,
  ApiOperation,
  DependencyConfidence,
  DependencyCycleFinding,
  TestScenario,
} from "@apipilot/shared-domain";
import { resolveProducerDisambiguation } from "../dependencies/mergeRelationships";
import type { WorkflowExtraction } from "./assertionScripts";
import { selectScenario, supportedField, workflowVariableName } from "./workflowRendering";
import { applyWorkflowSubstitutions } from "./workflowVariables";

/**
 * Renders CONFIRMED/LIKELY dependency relationships between *standalone* scenarios (ones not
 * already covered by an approved `IntegrationWorkflow`) as chained producer/consumer pairs,
 * without requiring a human to first assemble and approve them as a workflow (spec 019 FR-001,
 * FR-002; research.md D1-D9).
 *
 * Deliberately narrower than `workflowRendering.ts`'s `planWorkflow`: it evaluates one direct
 * (single-hop) relationship at a time rather than an entire multi-step candidate workflow, so one
 * missing piece of evidence only forecloses the parameters it actually affects (research.md D3).
 */

const PATH_PARAMETER_SEGMENT = /^\{(.+)\}$/;

type ScenarioOperationPair = { scenario: TestScenario; operation: ApiOperation };

function operationKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Deterministic, human-legible id for the producer group a relationship's producer field belongs to. */
function safeIdentifier(value: string): string {
  const collapsed = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+/, "").replace(/_+$/, "");
  return collapsed.length > 0 ? collapsed : "_";
}

function chainIdForProducer(producer: { operationPath: string; operationMethod: string; field: string }): string {
  return `auto_${safeIdentifier(producer.operationMethod)}_${safeIdentifier(producer.operationPath)}_${safeIdentifier(producer.field)}`;
}

/** One scenario/operation pair with an unresolved path parameter this relationship could fill. */
interface ConsumerTarget {
  scenario: TestScenario;
  operation: ApiOperation;
  field: string;
}

function consumerTargetKey(target: { operation: ApiOperation; field: string }): string {
  return `${operationKey(target.operation.path, target.operation.method)}|${target.field}`;
}

function relationshipConsumerKey(relationship: ApiDependencyRelationship): string {
  return `${operationKey(relationship.consumer.operationPath, relationship.consumer.operationMethod)}|${relationship.consumer.field}`;
}

function relationshipProducerKey(relationship: ApiDependencyRelationship): string {
  return `${operationKey(relationship.producer.operationPath, relationship.producer.operationMethod)}|${relationship.producer.field}`;
}

/** Every unresolved path parameter across the standalone scenario set (FR-001). */
function findUnresolvedPathConsumers(standaloneResolved: ScenarioOperationPair[]): ConsumerTarget[] {
  const targets: ConsumerTarget[] = [];
  for (const { scenario, operation } of standaloneResolved) {
    for (const segment of operation.path.split("/")) {
      const match = PATH_PARAMETER_SEGMENT.exec(segment);
      if (!match) continue;
      const name = match[1];
      if (scenario.request.pathParameters[name] === undefined) {
        targets.push({ scenario, operation, field: name });
      }
    }
  }
  return targets;
}

function groupByKey<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * The operation's approved *positive*-outcome scenario, if present among the standalone set
 * (FR-017) — never a negative/invalid-input scenario, since no human confirms this choice the way
 * approved-workflow step selection does.
 */
function positiveProducerScenario(
  standaloneResolved: ScenarioOperationPair[],
  producer: { operationPath: string; operationMethod: string },
): ScenarioOperationPair | undefined {
  const candidates = standaloneResolved.filter(
    (pair) => operationKey(pair.operation.path, pair.operation.method) === operationKey(producer.operationPath, producer.operationMethod),
  );
  if (candidates.length === 0) return undefined;
  const selected = selectScenario(
    candidates.map((pair) => pair.scenario),
    producer,
  );
  if (selected?.category !== "positive") return undefined;
  return candidates.find((pair) => pair.scenario.id === selected.id);
}

/** One relationship promoted to an automatic chain, and every consumer it resolves (FR-009). */
export interface AutomaticChain {
  chainId: string;
  variableName: string;
  producer: { operationPath: string; operationMethod: string; field: string; scenarioId: string };
  consumers: {
    operationPath: string;
    operationMethod: string;
    field: string;
    scenarioId: string;
    relationshipId: string;
    confidence: DependencyConfidence;
  }[];
}

/** Everything `planAutomaticChains` needs beyond the standalone scenario list (data-model.md). */
export interface AutomaticChainingInput {
  graph: ApiDependencyGraph;
  cycles: DependencyCycleFinding[];
  rejectedRelationshipIds: ReadonlySet<string>;
  /** `ExportOptions.disableAutomaticChaining` — when true, every input scenario passes through unchanged (FR-011). */
  disabled: boolean;
  /**
   * Each standalone scenario's rank in the collection's real, final emission order (computed by
   * `groupAndName` over the *unmodified* standalone list, whose sort keys never depend on chaining
   * decisions). Used only to enforce FR-015: a chain is never applied if it would place the
   * consumer before the producer under the collection's existing, unmodified ordering.
   */
  standaloneOrderRank: ReadonlyMap<string, number>;
}

export interface AutomaticChainingResult {
  /** `standaloneResolved`, unchanged except for pre-substituted `{{chainVar}}` path parameters on qualifying consumers. */
  scenarios: ScenarioOperationPair[];
  /** Extraction scripts to attach to a producer item's test event, keyed by that item's scenario id. */
  extractionsByProducerScenarioId: Map<string, WorkflowExtraction[]>;
  /** One entry per applied chain, for ExportSummary/README reporting (FR-010). */
  chains: AutomaticChain[];
}

function noop(standaloneResolved: ScenarioOperationPair[]): AutomaticChainingResult {
  return { scenarios: standaloneResolved, extractionsByProducerScenarioId: new Map(), chains: [] };
}

/** Eligibility filter shared by every candidate relationship, independent of grouping (FR-003/004/007/016/018). */
function isEligibleRelationship(
  relationship: ApiDependencyRelationship,
  targetsByKey: Map<string, ConsumerTarget[]>,
  cyclicRelationshipIds: ReadonlySet<string>,
  rejectedRelationshipIds: ReadonlySet<string>,
  standaloneResolved: ScenarioOperationPair[],
): boolean {
  if (relationship.confidence !== "CONFIRMED" && relationship.confidence !== "LIKELY") return false;
  if (relationship.consumer.location !== "path") return false;
  if (cyclicRelationshipIds.has(relationship.id)) return false;
  if (rejectedRelationshipIds.has(relationship.id)) return false;
  if (!supportedField(relationship.producer.field) || !supportedField(relationship.consumer.field)) return false;
  if (!targetsByKey.has(relationshipConsumerKey(relationship))) return false;
  return positiveProducerScenario(standaloneResolved, relationship.producer) !== undefined;
}

/**
 * Resolves one producer group into an `AutomaticChain` (applying every eligible consumer's
 * substitution as a side effect on `scenarioById`), or `undefined` if the ordering guard
 * (FR-015) disqualified every one of its consumers.
 */
function applyChainGroup(
  relationships: ApiDependencyRelationship[],
  standaloneResolved: ScenarioOperationPair[],
  targetsByKey: Map<string, ConsumerTarget[]>,
  standaloneOrderRank: ReadonlyMap<string, number>,
  scenarioById: Map<string, ScenarioOperationPair>,
): { chain: AutomaticChain; extraction: WorkflowExtraction } | undefined {
  const first = relationships[0];
  const producerPair = positiveProducerScenario(standaloneResolved, first.producer)!;
  const chainId = chainIdForProducer(first.producer);
  const producerRank = standaloneOrderRank.get(producerPair.scenario.id);

  const consumers: AutomaticChain["consumers"] = [];
  for (const relationship of relationships) {
    for (const target of targetsByKey.get(relationshipConsumerKey(relationship)) ?? []) {
      const consumerRank = standaloneOrderRank.get(target.scenario.id);
      if (producerRank === undefined || consumerRank === undefined || producerRank >= consumerRank) {
        continue; // FR-015: never reorder the collection to make a chain work — decline instead.
      }
      // Re-read the latest substituted version rather than the original `target.scenario`, so a
      // second chain targeting a different unresolved parameter on the same scenario (e.g.
      // `/a/{x}/b/{y}` chained from two different producers) accumulates both substitutions
      // instead of the second overwriting the first.
      const current = scenarioById.get(target.scenario.id)!;
      const substituted = applyWorkflowSubstitutions(current.scenario, chainId, [
        {
          name: first.producer.field,
          producerStepIndex: 0,
          producerField: first.producer.field,
          consumerStepIndex: 1,
          consumerLocation: "path",
          consumerField: relationship.consumer.field,
          relationshipId: relationship.id,
        },
      ]);
      scenarioById.set(target.scenario.id, { scenario: substituted, operation: current.operation });
      consumers.push({
        operationPath: relationship.consumer.operationPath,
        operationMethod: relationship.consumer.operationMethod,
        field: relationship.consumer.field,
        scenarioId: target.scenario.id,
        relationshipId: relationship.id,
        confidence: relationship.confidence,
      });
    }
  }
  if (consumers.length === 0) return undefined;

  return {
    chain: {
      chainId,
      variableName: workflowVariableName(chainId, first.producer.field),
      producer: {
        operationPath: first.producer.operationPath,
        operationMethod: first.producer.operationMethod,
        field: first.producer.field,
        scenarioId: producerPair.scenario.id,
      },
      consumers,
    },
    extraction: { workflowId: chainId, variableName: first.producer.field, responseField: first.producer.field },
  };
}

export function planAutomaticChains(
  standaloneResolved: ScenarioOperationPair[],
  input: AutomaticChainingInput,
): AutomaticChainingResult {
  if (input.disabled) return noop(standaloneResolved);

  const targetsByKey = groupByKey(findUnresolvedPathConsumers(standaloneResolved), consumerTargetKey);
  if (targetsByKey.size === 0) return noop(standaloneResolved);

  const cyclicRelationshipIds = new Set(input.cycles.flatMap((cycle) => cycle.relationshipIds));
  const candidateRelationships = input.graph.relationships.filter((relationship) =>
    isEligibleRelationship(relationship, targetsByKey, cyclicRelationshipIds, input.rejectedRelationshipIds, standaloneResolved),
  );
  if (candidateRelationships.length === 0) return noop(standaloneResolved);

  // FR-006: exactly one producer per consumer field, via the same tie-break used for manual
  // workflow assembly (008-dependency-workflow-engine FR-013a).
  const { resolved } = resolveProducerDisambiguation(candidateRelationships);

  // FR-009: group by producer field so a fan-out (one producer, several consumers) shares one
  // chain/variable/extraction instead of a redundant capture per consumer.
  const producerGroups = groupByKey(resolved, relationshipProducerKey);

  const scenarioById = new Map(standaloneResolved.map((pair) => [pair.scenario.id, pair]));
  const chains: AutomaticChain[] = [];
  const extractionsByProducerScenarioId = new Map<string, WorkflowExtraction[]>();

  for (const relationships of producerGroups.values()) {
    const outcome = applyChainGroup(relationships, standaloneResolved, targetsByKey, input.standaloneOrderRank, scenarioById);
    if (!outcome) continue;
    chains.push(outcome.chain);
    extractionsByProducerScenarioId.set(outcome.chain.producer.scenarioId, [
      ...(extractionsByProducerScenarioId.get(outcome.chain.producer.scenarioId) ?? []),
      outcome.extraction,
    ]);
  }

  return {
    scenarios: standaloneResolved.map((pair) => scenarioById.get(pair.scenario.id)!),
    extractionsByProducerScenarioId,
    chains,
  };
}
