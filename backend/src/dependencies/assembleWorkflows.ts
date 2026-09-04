import type {
  ApiDependencyRelationship,
  DependencyCycleFinding,
  IntegrationWorkflow,
  ManualConfirmationCandidate,
  WorkflowStep,
  WorkflowVariable,
} from "@apipilot/shared-domain";
import { buildDependencyGraph } from "./buildDependencyGraph";
import { workflowId } from "./identifiers";
import { resolveProducerDisambiguation } from "./mergeRelationships";

/** Default bound on assembled workflow length (research.md), informed by the SC-008 performance target. */
export const MAX_WORKFLOW_STEPS = 10;

interface OperationNode {
  path: string;
  method: string;
}

function nodeKey(node: OperationNode): string {
  return `${node.method} ${node.path}`;
}

function producerNode(relationship: ApiDependencyRelationship): OperationNode {
  return { path: relationship.producer.operationPath, method: relationship.producer.operationMethod };
}

function consumerNode(relationship: ApiDependencyRelationship): OperationNode {
  return { path: relationship.consumer.operationPath, method: relationship.consumer.operationMethod };
}

/** Deterministic ordering for outgoing edges at one node, so path enumeration never depends on input order. */
function edgeSortKey(relationship: ApiDependencyRelationship): string {
  const c = relationship.consumer;
  return `${c.operationMethod} ${c.operationPath} ${c.location ?? ""} ${c.field}`;
}

function buildWorkflowFromPath(pathRelationships: ApiDependencyRelationship[]): IntegrationWorkflow {
  const nodesInOrder: OperationNode[] = [producerNode(pathRelationships[0])];
  for (const relationship of pathRelationships) nodesInOrder.push(consumerNode(relationship));

  const steps: WorkflowStep[] = nodesInOrder.map((node, position) => ({
    position,
    operationPath: node.path,
    operationMethod: node.method,
    producesVariableNames: [],
    consumesVariableNames: [],
  }));

  const usedNames = new Set<string>();
  const variables: WorkflowVariable[] = pathRelationships.map((relationship, index) => {
    const baseName = relationship.consumer.field.split(".").pop() ?? relationship.consumer.field;
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${baseName}${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);

    const producerStepIndex = index;
    const consumerStepIndex = index + 1;
    steps[producerStepIndex].producesVariableNames.push(name);
    steps[consumerStepIndex].consumesVariableNames.push(name);

    return {
      name,
      producerStepIndex,
      producerField: relationship.producer.field,
      consumerStepIndex,
      consumerLocation: relationship.consumer.location ?? "body",
      consumerField: relationship.consumer.field,
      relationshipId: relationship.id,
    };
  });

  const relationshipIds = pathRelationships.map((relationship) => relationship.id);
  return { id: workflowId(relationshipIds), steps, variables, relationshipIds };
}

/**
 * Enumerates every bounded maximal path through the acyclic operation graph (research.md:
 * depth-first from each zero-in-degree node). An operation that is a valid next step for two
 * divergent chains naturally yields two separate workflows, since each branch is explored and
 * emitted independently.
 */
function enumerateWorkflows(
  relationships: ApiDependencyRelationship[],
  maxSteps: number,
): { workflows: IntegrationWorkflow[]; oversizedChainRelationshipIds: string[] } {
  const allNodeKeys = new Set<string>();
  const outgoingByNode = new Map<string, ApiDependencyRelationship[]>();
  const incomingCount = new Map<string, number>();

  for (const relationship of relationships) {
    const producerKey = nodeKey(producerNode(relationship));
    const consumerKey = nodeKey(consumerNode(relationship));
    allNodeKeys.add(producerKey);
    allNodeKeys.add(consumerKey);
    const outgoing = outgoingByNode.get(producerKey);
    if (outgoing) outgoing.push(relationship);
    else outgoingByNode.set(producerKey, [relationship]);
    incomingCount.set(consumerKey, (incomingCount.get(consumerKey) ?? 0) + 1);
  }

  const roots = [...allNodeKeys].filter((key) => !incomingCount.has(key)).sort();
  const workflows: IntegrationWorkflow[] = [];
  const oversizedChainRelationshipIds: string[] = [];

  const visit = (
    currentKey: string,
    pathRelationships: ApiDependencyRelationship[],
    visitedKeys: Set<string>,
    stepCount: number,
  ): void => {
    const outgoing = [...(outgoingByNode.get(currentKey) ?? [])].sort((a, b) =>
      edgeSortKey(a).localeCompare(edgeSortKey(b)),
    );
    let extended = false;
    for (const edge of outgoing) {
      const nextKey = nodeKey(consumerNode(edge));
      if (visitedKeys.has(nextKey)) continue;
      if (stepCount + 1 > maxSteps) {
        oversizedChainRelationshipIds.push(edge.id);
        continue;
      }
      extended = true;
      visit(nextKey, [...pathRelationships, edge], new Set([...visitedKeys, nextKey]), stepCount + 1);
    }
    if (!extended && pathRelationships.length > 0) {
      workflows.push(buildWorkflowFromPath(pathRelationships));
    }
  };

  for (const root of roots) {
    visit(root, [], new Set([root]), 1);
  }

  return { workflows, oversizedChainRelationshipIds };
}

export interface WorkflowAssemblyResult {
  workflows: IntegrationWorkflow[];
  manualConfirmationCandidates: ManualConfirmationCandidate[];
  cycles: DependencyCycleFinding[];
}

/**
 * Assembles CONFIRMED/LIKELY relationships into ordered, multi-step workflows (FR-011, FR-013,
 * FR-015). POSSIBLE relationships, disambiguation-excluded relationships (FR-013a), and chains
 * that would exceed `MAX_WORKFLOW_STEPS` are never silently dropped — each is surfaced as a
 * `ManualConfirmationCandidate` instead (FR-012, FR-014).
 */
export function assembleWorkflows(allRelationships: ApiDependencyRelationship[]): WorkflowAssemblyResult {
  const eligible = allRelationships.filter((r) => r.confidence === "CONFIRMED" || r.confidence === "LIKELY");
  const possible = allRelationships.filter((r) => r.confidence === "POSSIBLE");

  const { resolved, excluded } = resolveProducerDisambiguation(eligible);
  const { acyclicRelationships, cycles } = buildDependencyGraph(resolved);
  const { workflows, oversizedChainRelationshipIds } = enumerateWorkflows(acyclicRelationships, MAX_WORKFLOW_STEPS);

  const manualConfirmationCandidates: ManualConfirmationCandidate[] = [
    ...possible.map((r) => ({
      relationshipId: r.id,
      reason: "possible-confidence" as const,
      message: `Confidence is POSSIBLE only; confirm manually before including '${r.producer.field}' -> '${r.consumer.field}' in a workflow.`,
    })),
    ...excluded.map((r) => ({
      relationshipId: r.id,
      reason: "excluded-by-disambiguation" as const,
      message: "A stronger candidate producer was chosen for the same consuming field; confirm manually to use this relationship instead.",
    })),
    ...oversizedChainRelationshipIds.map((id) => ({
      relationshipId: id,
      reason: "chain-length-exceeded" as const,
      message: `Extending the workflow with this relationship would exceed the maximum of ${MAX_WORKFLOW_STEPS} steps; confirm manually to include it.`,
    })),
  ];

  return { workflows, manualConfirmationCandidates, cycles };
}
