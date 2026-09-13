# Phase 1 Data Model: Automatic Workflow Chaining for Postman Export

All types below are additive to existing `packages/shared-domain` contracts (`postmanArtifact.ts`)
or are new, backend-internal types (`backend/src/postman/automaticChaining.ts`) not exposed across
the shared-domain boundary. No existing field is renamed, removed, or given a breaking type change.

**Mapping from spec.md's Key Entities** (added post-`/speckit-analyze`, 2026-09-13, so a reader
tracing a Key Entity name from spec.md finds where it actually landed in code): spec.md describes
three conceptual entities — Automatic Chain, Chain Provenance Entry, and Chaining Eligibility
Decision. As built, the first two collapsed into one type, `AutomaticChain` (below), whose
`consumers[]` array *is* the chain-provenance detail (producer, each consumer, confidence,
relationship id) rather than a separate named type — a single producer can have several consumers,
which a single "entry" per relationship would have represented redundantly. "Chaining Eligibility
Decision" was never reified as a returned value; it is the control flow inside
`planAutomaticChains`/`isEligibleRelationship`/`applyChainGroup` — a relationship either becomes
part of a `chains[]` entry or it does not, and every disqualified case simply leaves the existing
`unresolved-path-parameter` limitation in place (FR-014), with no separate decision record
surfaced.

## Extended: `ExportOptions` (`packages/shared-domain/src/postmanArtifact.ts`)

```ts
export interface ExportOptions {
  baseUrl?: string;
  variableValues?: Record<string, string>;
  collectionName?: string;
  /** NEW. Default/absent = automatic chaining enabled (spec FR-002/FR-011). `true` reverts this
   *  export to today's approved-workflow-only rendering; there is no per-relationship exclusion
   *  (Clarifications, 2026-09-13). */
  disableAutomaticChaining?: boolean;
}
```

## Extended: `WorkflowExportContext` (`packages/shared-domain/src/postmanArtifact.ts`)

```ts
export interface WorkflowExportContext {
  workflows: IntegrationWorkflow[];
  approvedWorkflowIds: string[];
  /** NEW. Absent = no automatic-chaining context available (e.g. dependency analysis was never
   *  run for this export) — behaves exactly as today. */
  automaticChaining?: {
    graph: ApiDependencyGraph;
    cycles: DependencyCycleFinding[];
    /** Keyed by IntegrationWorkflow.id, mirroring TestGenerationWorkflow.workflowDecisions. */
    workflowDecisions: Record<string, WorkflowReviewDecision>;
  };
}
```

## New (shared-domain): `ChainOrigin`, extended `ArtifactVariable`, extended `ExportSummary`

```ts
export type ChainOrigin = "approved-workflow" | "automatic-chain";

export interface ArtifactVariable {
  name: string;
  purpose: string;
  secret: boolean;
  value: string;
  provenance?: {
    workflowId: string; // for an automatic chain, the synthetic chain id (see below)
    relationshipId?: string;
    /** NEW. Defaults to "approved-workflow" for existing callers/fixtures that predate this
     *  field, preserving current behavior for every provenance entry produced before this
     *  feature existed. */
    origin?: ChainOrigin;
  };
}

export interface ExportSummary {
  requestCount: number;
  folderCount: number;
  byProvenance: ProvenanceCounts;
  workflowCount: number;
  workflowRequestCount: number;
  standaloneRequestCount: number;
  workflowVariableCount: number;
  unsupportedWorkflowCount: number;
  omittedWorkflowCount: number;
  /** NEW. Count of path parameters resolved via an automatic chain in this export (spec SC-001/SC-003). */
  automaticChainCount: number;
}
```

## New (backend-internal): `backend/src/postman/automaticChaining.ts`

Implemented shape (as built — grouped by producer, so a fan-out to several consumers is one
`AutomaticChain` with several `consumers` entries, rather than one chain per relationship):

```ts
/** One producer group promoted to an automatic chain, and every consumer it resolved (FR-009). */
export interface AutomaticChain {
  /** Synthetic id used as the `workflowId` argument to the reused rendering primitives
   *  (`applyWorkflowSubstitutions`, `workflowVariableName`, `appendWorkflowExtractions`) —
   *  format `auto_<method>_<path>_<field>`, deterministic and stable regardless of which
   *  relationship ids happen to be in the group, collision-free against real
   *  `IntegrationWorkflow` ids and bare `pathParameterVariable` names. */
  chainId: string;
  variableName: string;
  producer: { operationPath: string; operationMethod: string; field: string; scenarioId: string };
  consumers: {
    operationPath: string;
    operationMethod: string;
    field: string;
    scenarioId: string;
    relationshipId: string;
    confidence: DependencyConfidence; // "CONFIRMED" | "LIKELY"
  }[];
}

/** Everything planAutomaticChains needs beyond the standalone scenario list — assembled by the
 *  caller (generateCollection.ts) from WorkflowExportContext.automaticChaining. */
export interface AutomaticChainingInput {
  graph: ApiDependencyGraph;
  cycles: DependencyCycleFinding[];
  rejectedRelationshipIds: ReadonlySet<string>; // derived from workflows + workflowDecisions (D7)
  disabled: boolean; // ExportOptions.disableAutomaticChaining
  /** Each standalone scenario's rank in the collection's real, final emission order — computed
   *  once by the caller via `groupAndName()` over the *unmodified* standalone list (whose sort
   *  keys never depend on chaining decisions), and reused unchanged to build the actual folders
   *  afterward. Enforces FR-015 without approximating or replicating folder-disambiguation logic. */
  standaloneOrderRank: ReadonlyMap<string, number>;
}

export interface AutomaticChainingResult {
  /** standaloneResolved scenarios, unchanged except for pre-substituted `{{chainVar}}` path
   *  parameters on qualifying consumers (mirrors applyWorkflowSubstitutions' output shape). */
  scenarios: { scenario: TestScenario; operation: ApiOperation }[];
  /** Extraction scripts to attach to a producer item's test event, keyed by that item's scenario id. */
  extractionsByProducerScenarioId: Map<string, WorkflowExtraction[]>;
  /** One entry per producer group that resolved at least one consumer, for ExportSummary/README reporting (FR-010). */
  chains: AutomaticChain[];
}

export function planAutomaticChains(
  standaloneResolved: { scenario: TestScenario; operation: ApiOperation }[],
  input: AutomaticChainingInput,
): AutomaticChainingResult;
```

### Eligibility rules encoded by `planAutomaticChains` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| `input.disabled` → return input unchanged, no chains. | FR-011 |
| Only `confidence` CONFIRMED/LIKELY relationships considered, and only `consumer.location === "path"`. | FR-003, FR-004 |
| Consumer's field must be an unresolved path parameter of a standalone scenario. | FR-001 |
| Producer operation's positive-outcome scenario must be present in `standaloneResolved` (out of scope for approved-workflow items, since D3 restricts this pass to standalone scenarios only). | FR-005, FR-017 |
| Both `producer.field` and `consumer.field` must pass the same `supportedField` guard `workflowRendering.ts` already applies. | (shared with 016's extraction-path guard) |
| Relationship id not in `cycles[].relationshipIds`. | FR-007 |
| Relationship id not in `rejectedRelationshipIds`. | FR-016 |
| When 2+ candidate producers exist for one consumer field, resolve via the existing `resolveProducerDisambiguation`. | FR-006 |
| Producer's item must be ranked before the consumer's item in `standaloneOrderRank`. | FR-015 |
| Relationship must be direct (single-hop) — `planAutomaticChains` never chains through an intermediate relationship. | FR-018 |
| Multiple consumers of the same producer field share one `chainId`/variable/extraction (grouped by producer path+method+field). | FR-009 |
| Two chains targeting different unresolved parameters on the *same* consumer scenario both apply (each substitution is layered onto the latest version of that scenario, not the original). | FR-009 (fan-in case) |

## Reused types (no data-model change — listed for traceability)

- `ApiDependencyGraph`, `ApiDependencyRelationship`, `DependencyConfidence`, `DeterministicDependencyEvidence`, `AIDependencyCorroboration`, `DependencyCycleFinding`, `IntegrationWorkflow`, `WorkflowVariable` — `packages/shared-domain/src/apiDependency.ts`. Unmodified.
- `WorkflowReviewDecision`, `WorkflowReviewState` — `packages/shared-domain/src/testGenerationWorkflow.ts`. Unmodified.
- `WorkflowExtraction`, `appendWorkflowExtractions` — `backend/src/postman/assertionScripts.ts`. Unmodified.
- `resolveProducerDisambiguation` — `backend/src/dependencies/mergeRelationships.ts`. Unmodified.
- `applyWorkflowSubstitutions` — `backend/src/postman/workflowVariables.ts`. Unmodified.
- `workflowVariableName` — `backend/src/postman/workflowRendering.ts`. Unmodified.
- `selectScenario` — `backend/src/postman/workflowRendering.ts`. Exported (was private) and its second
  parameter widened from `WorkflowStep` to `{ operationPath: string; operationMethod: string }`, a
  structurally-compatible supertype — the existing `planWorkflow` call site (`selectScenario(testModel.scenarios, step)`) is unaffected.
- `supportedField` — `backend/src/postman/workflowRendering.ts`. Exported (was private); logic unchanged.
- `groupAndName`, `compareRequestSortKeys` — `backend/src/postman/folders.ts` / `ordering.ts`. Unmodified; `groupAndName` is called an extra time by `generateCollection.ts` to compute `standaloneOrderRank` before chaining, and again afterward to build the real folders — both calls use the existing function as-is.
- `GenerationLimitation` (kind `"unresolved-path-parameter"`) — unchanged; still the fallback for every disqualified case.
