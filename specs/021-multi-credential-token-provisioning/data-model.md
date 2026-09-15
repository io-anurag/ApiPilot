# Phase 1 Data Model: Distinct-Credential Token Provisioning for Postman Export

All types below are additive to existing `packages/shared-domain` contracts (`postmanArtifact.ts`)
or are new, backend-internal types (`backend/src/postman/authMapping.ts`,
`backend/src/postman/credentialProducers.ts`) not exposed across the shared-domain boundary. No
existing field is renamed, removed, or given a breaking type change.

**Mapping from spec.md's Key Entities**: "Security Scheme Key" is the existing
`SecuritySchemeDefinition` record key (`packages/shared-domain/src/apiModel.ts`), used unchanged as
the grouping key. "Credential Variable" is the existing `ArtifactVariable` (unchanged shape),
produced with a scheme-derived `name` instead of always one of the four legacy literals. "Credential
Producer Candidate" is the new `CredentialProducerCandidate` type below.

## New (backend-internal): `backend/src/postman/authMapping.ts`

```ts
export type SchemeType = "bearer" | "basic" | "apiKey";

/** One security scheme key's resolved place in this export (spec FR-001–FR-003, FR-005). */
export interface SchemeVariablePlanEntry {
  type: SchemeType;
  /** True for the first-declared key of this `type` in `components.securitySchemes` document
   *  order — keeps the legacy default variable name(s), exactly as the single-scheme case. */
  isPrimary: boolean;
  /** The scheme key with a trailing case-insensitive `Auth`/`Scheme` suffix removed, or the full
   *  key when no such suffix is present. Reused verbatim by `credentialProducers.ts` (FR-006) so
   *  the producer heuristic searches for exactly the string the variable name is built from. */
  stem: string;
  /** Resolved variable name(s) for this scheme key. Exactly one shape per `type`. */
  variableNames:
    | { token: string }
    | { apiKey: string }
    | { username: string; password: string };
}

/**
 * Classifies and names every declared security scheme key for one export (FR-001–FR-003, FR-005).
 * Pure function of `securitySchemes` alone; a scheme whose type/scheme/in combination `mapScheme`
 * cannot configure (e.g. oauth2, openIdConnect) is omitted from the returned map — callers observe
 * this exactly as today's "unsupported-auth-scheme" limitation path already handles it.
 */
export function planSchemeVariables(
  securitySchemes: Record<string, SecuritySchemeDefinition>,
): Map<string, SchemeVariablePlanEntry>;
```

### Rules encoded by `planSchemeVariables` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| Group scheme keys by `(type, scheme-subtype)`: `http`/`bearer`, `http`/`basic`, `apiKey`. Two `apiKey` schemes with the same header `name` but different keys are still two groups' worth of *keys*, not merged. | FR-001, Acceptance Scenario 3 |
| Within each type group, the key appearing first in `Object.entries(securitySchemes)` (document declaration order) is `isPrimary: true` and resolves to the legacy literal name(s) (`token` / `apiKey` / `username`+`password`). | FR-002, FR-003, Clarifications 2026-09-15 |
| Every other same-type key resolves to `${stem}Token` / `${stem}ApiKey` / `${stem}Username`+`${stem}Password`, where `stem` strips a trailing case-insensitive `Auth`/`Scheme` suffix (or is the full key if none). | FR-003, Clarifications 2026-09-15 |
| A single scheme of a type (no siblings) is the trivial one-element case of the same rule — always primary, always the legacy name. | FR-002, SC-001 |
| Tag names, folder names, and path segments are never consulted. | FR-005 |

## Extended: `mapOperationAuth` (`backend/src/postman/authMapping.ts`)

```ts
export function mapOperationAuth(
  operation: ApiOperation,
  securitySchemes: Record<string, SecuritySchemeDefinition>,
  plan: Map<string, SchemeVariablePlanEntry>,
): AuthMapping; // unchanged return shape: { auth?, variables, limitations }
```

`mapScheme` (private) is extended to accept the resolved `variableNames` for the key being mapped,
building the same `PostmanAuth`/`ArtifactVariable` shape it does today but referencing the plan's
name(s) instead of the hard-coded literals. Every operation referencing an unrecognized scheme type
still falls back to the existing `"unsupported-auth-scheme"` limitation, unchanged (FR-005 does not
touch this path).

## New (backend-internal): `backend/src/postman/credentialProducers.ts`

```ts
import type { ApiOperation, CredentialProducerCandidate } from "@apipilot/shared-domain";
import type { SchemeVariablePlanEntry } from "./authMapping";

/**
 * For every non-primary scheme in `plan`, finds the sole unauthenticated operation in
 * `operations` whose path or `operationId` contains that scheme's `stem` (case-insensitive
 * substring). Zero or multiple matches for a scheme yields no candidate for it (FR-006's
 * "MUST NOT guess" clause) — the caller reports FR-007's limitation for that scheme instead.
 */
export function findCredentialProducers(
  operations: ApiOperation[],
  plan: Map<string, SchemeVariablePlanEntry>,
): CredentialProducerCandidate[];
```

`CredentialProducerCandidate` itself is a shared-domain type (below), not a backend-internal one —
it is the value carried on `ExportResult`, so it must live where `ExportResult` lives.

### Rules encoded by `findCredentialProducers` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| Only non-primary (`isPrimary: false`) plan entries are searched — the primary scheme of each type never needs an auto-discovered producer under this spec. | FR-006 |
| Candidate operations must have `security.length === 0` (no authentication requirement of their own). | FR-006, Edge Cases |
| Candidate match is a case-insensitive substring test of the scheme's `stem` against the operation's `path` or `operationId`. | FR-006, Clarifications 2026-09-15 |
| Exactly one match ⇒ one `CredentialProducerCandidate`; zero or 2+ matches ⇒ no candidate for that scheme. | FR-006, Edge Cases |

## Extended (shared-domain): `CredentialProducerCandidate`, `GenerationLimitationKind`, `ExportResult` (`packages/shared-domain/src/postmanArtifact.ts`)

```ts
/** One distinct scheme's identified credential-obtaining operation (FR-006). */
export interface CredentialProducerCandidate {
  schemeKey: string;
  variableName: string;
  producerOperationPath: string;
  producerOperationMethod: string;
}

export type GenerationLimitationKind =
  | "no-expected-outcome"
  | "undocumented-status-code"
  | "unsupported-auth-scheme"
  | "unsupported-content-type"
  | "unresolved-path-parameter"
  | "specification-analysis-issue"
  | "alternative-auth-requirement-selected"
  | "workflow-missing-scenario"
  | "workflow-unsupported-sequence"
  | "workflow-unresolved-handoff"
  | "workflow-unsupported-extraction-path"
  | "workflow-unsupported-request-representation"
  | "unresolved-credential-producer"; // NEW (FR-007)

export interface ExportResult {
  collection: PostmanCollection;
  environment: PostmanEnvironment;
  readme: ArtifactDocument;
  validation: ValidationReport;
  limitations: GenerationLimitation[];
  summary: ExportSummary;
  /** NEW. One entry per distinct scheme whose credential-producer operation was identified
   *  (FR-006) — the contract a future automatic-chaining extension (FR-009) wires values through.
   *  Always present; empty when no distinct scheme had a discoverable producer. */
  credentialProducers: CredentialProducerCandidate[];
}
```

`credentialProducers` being a required (non-optional) array — rather than an optional field — means
every existing `ExportResult` construction site (backend generator, test fixtures) must supply it
explicitly, surfacing every place the type is built instead of letting the new data silently default
to absent (constitution XIV, No Silent Assumptions).

## New `GenerationLimitation` shape for FR-007 (no type change — usage convention)

A `GenerationLimitation` with `kind: "unresolved-credential-producer"` is emitted **once per
unresolved distinct scheme** (not once per affected operation, unlike most existing limitation
kinds):

- `location`: the scheme key itself (e.g. `security scheme "adminAuth"`), distinguishing it from
  every existing kind's `"METHOD /path"` operation-location convention.
- `message`: names the scheme key and lists every operation (in `"METHOD /path"` form) among the
  export's approved scenarios that references it.

This keeps `aggregateLimitations` (unchanged) meaningful: the (kind, location, message) triple is
still the natural dedup key, and one scheme's unresolved-producer case cannot accidentally collapse
into another's.

## Reused types (no data-model change — listed for traceability)

- `ApiOperation`, `SecuritySchemeDefinition`, `SecurityRequirement` — `packages/shared-domain/src/apiModel.ts`. Unmodified; `SecuritySchemeDefinition`'s existing `type`/`scheme`/`in`/`name` fields are sufficient input to `planSchemeVariables`'s type classification (identical to `mapScheme`'s existing conditions).
- `ArtifactVariable`, `PostmanAuth`, `GenerationLimitation` — `packages/shared-domain/src/postmanArtifact.ts`. Unmodified shape; only the *values* placed into `ArtifactVariable.name`/`PostmanAuth`'s attribute values change for non-primary schemes.
- `credentialVariable` — `backend/src/postman/artifactVariables.ts`. Extended with an optional second parameter (D4); existing call sites unaffected.
- `dedupeVariables` — `backend/src/postman/generateCollection.ts`. Unmodified; already merges `ArtifactVariable[]` by `.name`, which is sufficient for multiple operations under the same distinct scheme collapsing to one `{{adminToken}}` declaration.
