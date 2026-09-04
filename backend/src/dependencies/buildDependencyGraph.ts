import type { ApiDependencyRelationship, DependencyCycleFinding } from "@apipilot/shared-domain";

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

export interface DependencyGraphBuildResult {
  acyclicRelationships: ApiDependencyRelationship[];
  cycles: DependencyCycleFinding[];
}

/**
 * Builds the operation-level directed graph from disambiguated CONFIRMED/LIKELY relationships and
 * detects cycles with Kahn's algorithm (research.md): repeatedly remove zero-in-degree nodes; any
 * nodes left when the algorithm terminates are part of (or exclusively downstream of) a cycle.
 * Relationships whose producer and consumer operations are both among the remaining nodes are
 * excluded from the acyclic set and reported as cycle findings instead (FR-014); every other
 * relationship is returned unchanged.
 */
export function buildDependencyGraph(relationships: ApiDependencyRelationship[]): DependencyGraphBuildResult {
  const nodes = new Map<string, OperationNode>();
  const outgoing = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  const ensureNode = (node: OperationNode): string => {
    const key = nodeKey(node);
    if (!nodes.has(key)) {
      nodes.set(key, node);
      outgoing.set(key, new Set());
      inDegree.set(key, 0);
    }
    return key;
  };

  for (const relationship of relationships) {
    const producerKey = ensureNode(producerNode(relationship));
    const consumerKey = ensureNode(consumerNode(relationship));
    const edges = outgoing.get(producerKey);
    if (edges && !edges.has(consumerKey)) {
      edges.add(consumerKey);
      inDegree.set(consumerKey, (inDegree.get(consumerKey) ?? 0) + 1);
    }
  }

  const remainingInDegree = new Map(inDegree);
  const queue = [...nodes.keys()].filter((key) => (remainingInDegree.get(key) ?? 0) === 0).sort();
  const removed = new Set<string>();
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    removed.add(current);
    for (const neighbor of outgoing.get(current) ?? []) {
      if (removed.has(neighbor)) continue;
      const next = (remainingInDegree.get(neighbor) ?? 0) - 1;
      remainingInDegree.set(neighbor, next);
      if (next === 0) queue.push(neighbor);
    }
  }

  const cyclicNodeSet = new Set([...nodes.keys()].filter((key) => !removed.has(key)));

  const acyclicRelationships: ApiDependencyRelationship[] = [];
  const cyclicRelationships: ApiDependencyRelationship[] = [];
  for (const relationship of relationships) {
    const producerKey = nodeKey(producerNode(relationship));
    const consumerKey = nodeKey(consumerNode(relationship));
    if (cyclicNodeSet.has(producerKey) && cyclicNodeSet.has(consumerKey)) {
      cyclicRelationships.push(relationship);
    } else {
      acyclicRelationships.push(relationship);
    }
  }

  return { acyclicRelationships, cycles: groupCyclicRelationshipsIntoFindings(cyclicRelationships, nodes) };
}

/** Groups cyclic relationships into one finding per weakly-connected component (union-find). */
function groupCyclicRelationshipsIntoFindings(
  cyclicRelationships: ApiDependencyRelationship[],
  nodes: Map<string, OperationNode>,
): DependencyCycleFinding[] {
  if (cyclicRelationships.length === 0) return [];

  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const relationship of cyclicRelationships) {
    const producerKey = nodeKey(producerNode(relationship));
    const consumerKey = nodeKey(consumerNode(relationship));
    if (!parent.has(producerKey)) parent.set(producerKey, producerKey);
    if (!parent.has(consumerKey)) parent.set(consumerKey, consumerKey);
    union(producerKey, consumerKey);
  }

  const componentGroups = new Map<string, ApiDependencyRelationship[]>();
  for (const relationship of cyclicRelationships) {
    const root = find(nodeKey(producerNode(relationship)));
    const group = componentGroups.get(root);
    if (group) group.push(relationship);
    else componentGroups.set(root, [relationship]);
  }

  const findings = [...componentGroups.values()].map((group) => {
    const involvedKeys = new Set<string>();
    for (const relationship of group) {
      involvedKeys.add(nodeKey(producerNode(relationship)));
      involvedKeys.add(nodeKey(consumerNode(relationship)));
    }
    const operations = [...involvedKeys]
      .sort()
      .map((key) => nodes.get(key))
      .filter((node): node is OperationNode => Boolean(node));
    return {
      relationshipIds: group.map((r) => r.id).sort(),
      operations,
      message: `Cyclical dependency detected among ${operations.length} operation(s): each depends on the other, so no consistent step order exists.`,
    };
  });

  return findings.sort((a, b) => a.relationshipIds.join(",").localeCompare(b.relationshipIds.join(",")));
}
