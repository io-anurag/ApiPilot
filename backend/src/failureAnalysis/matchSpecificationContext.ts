import type {
  PostmanCollection,
  PostmanFolder,
  PostmanRequestItem,
  SpecificationContext,
  TestGenerationWorkflow,
  UpstreamContext,
  UploadedRequestResult,
} from "@apipilot/shared-domain";

/**
 * The parts of a guided workflow that specification context is resolved from. A
 * `TestGenerationWorkflow` satisfies it; the narrower type keeps the dependency explicit.
 */
export type SpecificationContextSource = Pick<
  TestGenerationWorkflow,
  "id" | "apiModel" | "approvedTestModel" | "dependencyAnalysis"
> & { postmanArtifact?: { collection: PostmanCollection } };

type ItemProvenance = NonNullable<PostmanRequestItem["provenance"]>;

function isFolder(entry: PostmanFolder | PostmanRequestItem): entry is PostmanFolder {
  return !("request" in entry) && Array.isArray((entry as PostmanFolder).item);
}

/** Every generated item's provenance by item id, walking folders at any depth. */
function indexProvenance(collection: PostmanCollection): Map<string, ItemProvenance | undefined> {
  const index = new Map<string, ItemProvenance | undefined>();
  const visit = (entries: ReadonlyArray<PostmanFolder | PostmanRequestItem>): void => {
    for (const entry of entries) {
      if (isFolder(entry)) visit(entry.item);
      else index.set(entry.id, entry.provenance);
    }
  };
  visit(collection.item);
  return index;
}

/**
 * Attaches specification context to a failed result only by exact item-id match against the
 * session's current guided-workflow collection — never by name or path similarity (FR-018,
 * research D3). Upstream outcomes are read from results recorded earlier in the same run.
 */
export function matchSpecificationContext(
  result: UploadedRequestResult,
  workflow: SpecificationContextSource | undefined,
  runResults: readonly UploadedRequestResult[],
  resultIndex: number,
): SpecificationContext {
  if (!result.itemId) return { status: "unavailable", reason: "no-request-identity" };
  const collection = workflow?.postmanArtifact?.collection;
  if (!workflow || !collection) return { status: "unavailable", reason: "no-generated-collection" };

  const provenanceById = indexProvenance(collection);
  if (!provenanceById.has(result.itemId)) {
    return { status: "unavailable", reason: "not-generated-by-current-workflow" };
  }
  const provenance = provenanceById.get(result.itemId);
  const scenario = provenance?.scenarioId
    ? workflow.approvedTestModel?.scenarios.find((candidate) => candidate.id === provenance.scenarioId)
    : undefined;
  if (!provenance || !scenario) return { status: "unavailable", reason: "no-originating-scenario" };

  const operation = workflow.apiModel?.operations.find(
    (candidate) =>
      candidate.path === scenario.operationPath &&
      candidate.method.toUpperCase() === scenario.operationMethod.toUpperCase(),
  );

  const earlierResults = runResults.slice(0, resultIndex).map((earlier) => ({
    result: earlier,
    provenance: earlier.itemId ? provenanceById.get(earlier.itemId) : undefined,
  }));

  return {
    status: "matched",
    workflowId: workflow.id,
    scenarioId: scenario.id,
    scenarioName: scenario.provenance.description,
    scenarioCategory: scenario.category,
    operationPath: scenario.operationPath,
    operationMethod: scenario.operationMethod,
    documentedStatusCodes: operation?.responses.map((response) => response.statusCode) ?? [],
    requestEditedAfterGeneration: result.wasEdited === true,
    upstream: resolveUpstream(provenance, workflow, earlierResults, {
      path: scenario.operationPath,
      method: scenario.operationMethod,
    }),
  };
}

interface EarlierResult {
  result: UploadedRequestResult;
  provenance: ItemProvenance | undefined;
}

function outcomeOf(found: EarlierResult | undefined): UpstreamContext["outcomeInRun"] {
  return found ? found.result.outcome : "not-in-run";
}

/** The last matching result before this one — the attempt whose output this request would have used. */
function nearestPreceding(
  earlierResults: readonly EarlierResult[],
  matches: (entry: EarlierResult) => boolean,
): EarlierResult | undefined {
  for (let index = earlierResults.length - 1; index >= 0; index -= 1) {
    if (matches(earlierResults[index])) return earlierResults[index];
  }
  return undefined;
}

function sameOperation(a: Operation, b: Operation): boolean {
  return a.path === b.path && a.method.toUpperCase() === b.method.toUpperCase();
}

interface Operation {
  path: string;
  method: string;
}

/** Earlier steps of the same approved workflow whose variables this step consumes. */
function workflowUpstream(
  provenance: ItemProvenance,
  workflow: SpecificationContextSource,
  earlierResults: readonly EarlierResult[],
): { upstream: UpstreamContext[]; coveredRelationshipIds: Set<string> } {
  const coveredRelationshipIds = new Set<string>();
  const stepPosition = provenance.stepPosition;
  const integrationWorkflow =
    stepPosition === undefined
      ? undefined
      : workflow.dependencyAnalysis?.workflows.find((candidate) => candidate.id === provenance.workflowId);
  if (!integrationWorkflow || stepPosition === undefined) return { upstream: [], coveredRelationshipIds };

  const suppliedByStep = new Map<number, string[]>();
  for (const variable of integrationWorkflow.variables) {
    if (variable.consumerStepIndex !== stepPosition || variable.producerStepIndex >= stepPosition) continue;
    suppliedByStep.set(variable.producerStepIndex, [
      ...(suppliedByStep.get(variable.producerStepIndex) ?? []),
      variable.name,
    ]);
    coveredRelationshipIds.add(variable.relationshipId);
  }

  const upstream: UpstreamContext[] = [];
  for (const [producerStepIndex, suppliedFields] of [...suppliedByStep].sort(([a], [b]) => a - b)) {
    const step = integrationWorkflow.steps.find((candidate) => candidate.position === producerStepIndex);
    if (!step) continue;
    const found = nearestPreceding(
      earlierResults,
      (entry) =>
        entry.provenance?.workflowId === integrationWorkflow.id &&
        entry.provenance.stepPosition === producerStepIndex,
    );
    upstream.push({
      via: "integration-workflow",
      stepPosition: producerStepIndex,
      operationPath: step.operationPath,
      operationMethod: step.operationMethod,
      suppliedFields,
      outcomeInRun: outcomeOf(found),
    });
  }
  return { upstream, coveredRelationshipIds };
}

/** Producers of recorded dependency relationships this request consumes. */
function relationshipUpstream(
  provenance: ItemProvenance,
  workflow: SpecificationContextSource,
  earlierResults: readonly EarlierResult[],
  ownOperation: Operation,
  coveredRelationshipIds: ReadonlySet<string>,
): UpstreamContext[] {
  const operationOfResult = (entry: EarlierResult): Operation | undefined => {
    const scenario = workflow.approvedTestModel?.scenarios.find(
      (candidate) => candidate.id === entry.provenance?.scenarioId,
    );
    return scenario ? { path: scenario.operationPath, method: scenario.operationMethod } : undefined;
  };

  const upstream: UpstreamContext[] = [];
  for (const relationshipId of provenance.relationshipIds ?? []) {
    if (coveredRelationshipIds.has(relationshipId)) continue;
    const relationship = workflow.dependencyAnalysis?.graph.relationships.find(
      (candidate) => candidate.id === relationshipId,
    );
    if (!relationship) continue;
    // A workflow's items all carry the workflow's relationship ids, so keep only relationships
    // this request actually consumes; otherwise the producer step would list itself.
    const consumer = { path: relationship.consumer.operationPath, method: relationship.consumer.operationMethod };
    if (!sameOperation(consumer, ownOperation)) continue;

    const producer = { path: relationship.producer.operationPath, method: relationship.producer.operationMethod };
    const found = nearestPreceding(earlierResults, (entry) => {
      const operation = operationOfResult(entry);
      return operation !== undefined && sameOperation(operation, producer);
    });
    upstream.push({
      via: "dependency-relationship",
      operationPath: producer.path,
      operationMethod: producer.method,
      suppliedFields: [relationship.producer.field],
      outcomeInRun: outcomeOf(found),
    });
  }
  return upstream;
}

function resolveUpstream(
  provenance: ItemProvenance,
  workflow: SpecificationContextSource,
  earlierResults: readonly EarlierResult[],
  ownOperation: Operation,
): UpstreamContext[] {
  const fromWorkflow = workflowUpstream(provenance, workflow, earlierResults);
  return [
    ...fromWorkflow.upstream,
    ...relationshipUpstream(provenance, workflow, earlierResults, ownOperation, fromWorkflow.coveredRelationshipIds),
  ];
}
