# Phase 1 Data Model: Automatic Auth-Credential Chaining

All types below are additive to existing `packages/shared-domain` contracts (`apiDependency.ts`) or
are new/extended, backend-internal types (`backend/src/postman/*`) not exposed across the shared-
domain boundary. No existing field is renamed, removed, or given a breaking type change.

**Mapping from spec.md's Key Entities**: "Auth Consumer Field" is a `FieldRef` with
`location: "auth"` (new). "Credential Producer Candidate" is the existing, unchanged
`CredentialProducerCandidate` (specs/021), whose *discovery* is widened (data model unchanged,
behavior extended — see below). "Auth-Credential Relationship" is an `ApiDependencyRelationship`
built by the new `authCredentialRelationships.ts` module.

## Extended (shared-domain): `DependencyFieldLocation` (`packages/shared-domain/src/apiDependency.ts`)

```ts
// Before
export type DependencyFieldLocation = "path" | "query" | "header" | "body";

// After (FR-001)
export type DependencyFieldLocation = "path" | "query" | "header" | "body" | "auth";
```

No other field on `FieldRef`, `ApiDependencyRelationship`, `ApiDependencyGraph`, `WorkflowVariable`,
or `IntegrationWorkflow` changes shape. A `FieldRef` with `location: "auth"` has:

| Field | Meaning for an auth consumer |
|---|---|
| `operationPath` / `operationMethod` | The consuming operation (one that declares the scheme). |
| `field` | The security scheme key from `components.securitySchemes` (e.g. `bearerAuth`) — **not** a parameter or body field name. |
| `location` | `"auth"`. |

## Extended (backend-internal): `findCredentialProducers` (`backend/src/postman/credentialProducers.ts`)

```ts
// Before: `if (entry.isPrimary) continue;` skipped every primary scheme.
// After: every plan entry is searched (primary and non-primary alike); the `entry.type === "basic"`
// skip is unchanged.
export function findCredentialProducers(
  operations: ApiOperation[],
  plan: Map<string, SchemeVariablePlanEntry>,
): CredentialProducerCandidate[]; // return type and stem-match heuristic unchanged
```

### Rules encoded by the extended `findCredentialProducers` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| Every scheme in `plan` is searched, including the primary (first-declared-per-type) scheme — no longer only non-first-declared ones. | FR-002, Clarifications 2026-09-15 (Q1) |
| The candidate-matching heuristic itself (unauthenticated operation; case-insensitive stem substring of the scheme key in path/`operationId`) is unchanged and applies identically to primary and non-primary schemes — no relaxed or name-convention fallback. | FR-002, Clarifications 2026-09-15 (Q3) |
| `entry.type === "basic"` schemes are still never searched. | FR-002a |
| Zero or 2+ unauthenticated matches for a scheme ⇒ no candidate, unchanged. | FR-002, Edge Cases |

## New (backend-internal): `backend/src/postman/authCredentialRelationships.ts`

```ts
import type {
  ApiDependencyRelationship,
  ApiOperation,
  CredentialProducerCandidate,
} from "@apipilot/shared-domain";
import { producerFieldSchemas } from "../dependencies/fieldExtraction";
import { relationshipId } from "../dependencies/identifiers";

/**
 * Builds one ApiDependencyRelationship per (resolved scheme, consuming operation) pair (FR-002,
 * FR-003). For each candidate, the producer operation's documented 2xx response is inspected via
 * the same `producerFieldSchemas` deterministicMatching.ts already uses; when exactly one field is
 * string-typed, one relationship per operation whose first declared security requirement's first
 * scheme matches `candidate.schemeKey` is created. Zero or 2+ qualifying fields, or zero matching
 * consumer operations, yields no relationships for that scheme (FR-004) — the caller
 * (generateCollection.ts) is responsible for reporting the resulting gap via the existing
 * unresolved-credential-producer limitation.
 */
export function buildAuthCredentialRelationships(
  operations: ApiOperation[],
  credentialProducers: CredentialProducerCandidate[],
): ApiDependencyRelationship[];
```

### Rules encoded by `buildAuthCredentialRelationships` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| Producer field candidates come from the producer operation's documented 2xx response schemas (`producerFieldSchemas`, reused unmodified from `dependencies/fieldExtraction.ts`), filtered to `schema.type === "string"`. | FR-003 |
| Exactly one qualifying field ⇒ that field is the relationship's producer `FieldRef`; zero or 2+ ⇒ no relationship for that scheme. | FR-003, FR-004 |
| One relationship per operation whose `operation.security[0]?.schemes[0]?.name === candidate.schemeKey` (mirrors `mapOperationAuth`'s own precedence rule) — consumer `FieldRef` is `{operationPath, operationMethod, field: schemeKey, location: "auth"}`. | FR-001, FR-003, Acceptance Scenario 2 |
| Every produced relationship is `confidence: "CONFIRMED"`, `source: "deterministic"` (research.md D2). | FR-005 |
| `http`/`basic` schemes never appear in `credentialProducers` (unchanged 021 behavior), so no relationship is ever built for one. | FR-002a |
| `id` is `relationshipId(producer, consumer)`, reused unmodified from `../dependencies/identifiers` — the same deterministic id function `deterministicMatching.ts` already uses, so an auth-credential relationship's id is computed identically to every other relationship's. | Constitution XIII, XVI |
| `explanation` is a human-readable sentence naming the scheme, the producer operation/field, and the consuming operation, e.g. `` `${producer.operationMethod} ${producer.operationPath} returns '${producer.field}'; ${consumer.operationMethod} ${consumer.operationPath} requires the "${schemeKey}" security scheme (sole plausible credential field on an otherwise-unauthenticated producer's response).` `` — mirrors `deterministicMatching.ts`'s `explainEvidence` in spirit (a reviewer must be able to see why the relationship exists) without reusing its signal-name wording, since auth-credential relationships carry no `DeterministicDependencyEvidence` (`evidence` stays `undefined`). | Constitution XIII |

## Extended: `automaticChaining.ts`

```ts
// isEligibleRelationship: consumer.location check widened
- if (relationship.consumer.location !== "path") return false;
+ if (relationship.consumer.location !== "path" && relationship.consumer.location !== "auth") return false;

// New sibling to findUnresolvedPathConsumers (research.md D4): every operation declaring a scheme
// is unconditionally a target — no "already supplied" check, unlike path parameters.
function findAuthConsumerTargets(standaloneResolved: ScenarioOperationPair[]): ConsumerTarget[];

// AutomaticChainingInput gains one new field (research.md D6): scheme key -> credential variable
// name, threaded from generateCollection.ts's `plan` so applyChainGroup can resolve the fixed name
// for an auth chain without recomputing it.
export interface AutomaticChainingInput {
  // ...existing fields unchanged...
  credentialVariableNames: ReadonlyMap<string, string>;
}
```

`applyChainGroup` behavior by `relationship.consumer.location`:

| | `"path"` (unchanged) | `"auth"` (new) |
|---|---|---|
| Scenario mutation | `applyWorkflowSubstitutions` rewrites the unresolved path parameter to `{{workflowVariableName(chainId, field)}}`. | None — the operation's `PostmanAuth` block already references the fixed credential variable, independent of chaining (research.md D5). |
| `AutomaticChain.variableName` | `workflowVariableName(chainId, producer.field)` (unchanged). | `credentialVariableNames.get(producer.field)` — the scheme's already-emitted `token`/`adminToken`/… (research.md D6). |
| `WorkflowExtraction` | No `finalVariableName` (unchanged; capture writes to the derived chain variable). | `finalVariableName` set to the same resolved credential variable name. |
| Producer grouping | Grouped with other `"path"` relationships sharing the same producer field. | Grouped with other `"auth"` relationships sharing the same producer field, **never** merged with a `"path"` group for the same field (research.md D7). |

## Extended: `WorkflowExtraction` (`backend/src/postman/assertionScripts.ts`)

```ts
export interface WorkflowExtraction {
  workflowId: string;
  variableName: string;
  responseField: string;
  /** NEW. When present, the capture writes to exactly this variable name instead of deriving one
   *  via `workflowVariableName(workflowId, variableName)` (research.md D6). Used only for an
   *  auth-credential chain's extraction, where the target is a fixed, already-emitted credential
   *  variable name (e.g. "token"), not a chain-scoped derived name. */
  finalVariableName?: string;
}
```

`extractionLines` uses `extraction.finalVariableName ?? workflowVariableName(extraction.workflowId, extraction.variableName)`
as the variable passed to `pm.environment.set(...)`. Every existing call site omits the field and is
byte-for-byte unaffected.

## Extended: `unresolvedCredentialProducerLimitations` (`backend/src/postman/generateCollection.ts`)

```ts
// Before: `if (entry.isPrimary || resolvedSchemeKeys.has(schemeKey)) continue;`
//   resolvedSchemeKeys came from `credentialProducers` (operation-level discovery only).
// After: the isPrimary skip is removed; resolvedSchemeKeys is derived from the schemes that
//   actually received an authCredentialRelationships.ts relationship (field-level resolution),
//   so a discovered-but-field-ambiguous producer still reports the limitation (research.md D3).
```

| Rule | Spec reference |
|---|---|
| A scheme is "resolved" (no limitation) only when it has at least one built auth-credential relationship, not merely a discovered producer operation. | FR-004 |
| The primary scheme is no longer exempt from this limitation. | Clarifications 2026-09-15 (Q1), FR-002 |
| Message wording, aggregation key, and per-scheme (not per-operation) reporting cadence are unchanged. | FR-009 |

## Reused types (no data-model change — listed for traceability)

- `CredentialProducerCandidate` — `packages/shared-domain/src/postmanArtifact.ts`. Unmodified; still
  identification-only (operation, not field). This feature's relationship-builder consumes it as
  input and separately determines the producer *field*.
- `ApiDependencyRelationship`, `ApiDependencyGraph`, `DependencyConfidence` —
  `packages/shared-domain/src/apiDependency.ts`. Unmodified shape; only `FieldRef.location`'s value
  set grows.
- `producerFieldSchemas` — `backend/src/dependencies/fieldExtraction.ts`. Unmodified; reused by the
  new module exactly as `deterministicMatching.ts` already uses it.
- `resolveProducerDisambiguation` — `backend/src/dependencies/mergeRelationships.ts`. Unmodified;
  continues to key disambiguation by consumer (operation, field), which is already unique per
  consuming operation for an auth relationship (one scheme per operation's first requirement).
- `ExportSummary.automaticChainCount` — `packages/shared-domain/src/postmanArtifact.ts`. Unmodified
  field and computation (`automaticChaining.chains.reduce((c, chain) => c + chain.consumers.length, 0)`);
  its doc comment ("Count of path parameters resolved...") is updated to also mention auth
  credentials, since the same counter now naturally includes both.
