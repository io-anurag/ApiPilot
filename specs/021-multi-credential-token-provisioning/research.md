# Phase 0 Research: Distinct-Credential Token Provisioning for Postman Export

All Technical Context fields were resolved directly from the existing codebase and constitution;
no NEEDS CLARIFICATION markers remained after `/speckit.clarify` (three rounds of clarification —
2026-09-14 drafting-time and 2026-09-15 — already resolved every open product decision, including
the declaration-order primacy rule, the exact name-derivation algorithm, and the producer-discovery
heuristic). This document instead records the architecture decisions made while reading the
existing `backend/src/postman/authMapping.ts`, `artifactVariables.ts`, `automaticChaining.ts`, and
`packages/shared-domain/src/postmanArtifact.ts`, each of which had a real, non-obvious alternative.

## D1 — One pure planning function, computed once per export, not per operation

**Decision**: Add `planSchemeVariables(securitySchemes)` to `authMapping.ts`: a pure function of
`ApiModel.securitySchemes` alone that classifies every scheme key's type (`bearer`/`basic`/`apiKey`/
unsupported), groups keys by type in `Object.entries` declaration order, marks the first key of each
type group as primary, and computes every key's resolved variable name(s) (spec FR-001–FR-003).
`generateCollection.ts`'s `authByOperation` computes this plan once and threads it through every
`mapOperationAuth` call for the export, rather than each call recomputing it from the same
`securitySchemes` record.

**Rationale**: The primacy and naming decision for a scheme key depends on every *other* key
declared in the document (which one came first), not on the one operation being mapped — computing
it inside `mapOperationAuth` per operation would still be correct (the function is pure and cheap),
but a single shared `Map` computed once keeps one authoritative source of truth for "what does
`adminAuth` resolve to in this export" that both the per-operation auth mapping (FR-004) and the
new producer-discovery pass (FR-006) consume identically, and avoids the plan silently drifting if
one caller's copy of `securitySchemes` differs from another's.

**Alternatives considered**:
- *Recompute the plan inside `mapOperationAuth` on every call.* Rejected: works for FR-001–FR-004
  in isolation, but the producer-discovery pass (FR-006) and the unresolved-scheme limitation
  reporting (FR-007) both need the same primacy/stem data over the *whole* operation set, so a
  shared, single computation is the smaller total change.

## D2 — Extend `mapOperationAuth`'s signature rather than re-deriving names inside `mapScheme`

**Decision**: `mapOperationAuth(operation, securitySchemes, plan)` takes the precomputed
`Map<string, SchemeVariablePlanEntry>` from D1 as a required third parameter. `mapScheme` (the
per-scheme-type → `PostmanAuth`/`ArtifactVariable` mapper) is extended to accept the resolved
variable name(s) for the scheme it is mapping, instead of hard-coding the literal strings `"token"`,
`"apiKey"`, `"username"`, `"password"`.

**Rationale**: `mapScheme` already fully owns "how does a bearer/basic/apiKey scheme become a
`PostmanAuth` block" (constitution IX); teaching it to accept a variable name rather than assume one
keeps that ownership intact and is a strictly smaller change than duplicating its `PostmanAuth`-
building logic in a second function for the distinct-scheme case. The existing single-scheme tests
(`authMapping.test.ts`) are updated to pass a plan computed from their own fixture's
`securitySchemes` (still resolving to `token`/`apiKey`/`username`/`password` for every fixture
scheme, since none of `exportApiModel`'s schemes share a type) — SC-001's backward-compatibility
guarantee is verified at the output level (identical `PostmanAuth`/`ArtifactVariable` shape), not by
preserving an internal function's exact argument count.

**Alternatives considered**:
- *Keep `mapOperationAuth`'s two-argument signature and have it look up a module-level cache keyed
  by the `securitySchemes` object identity.* Rejected: an identity-keyed cache is a hidden global
  correctness dependency (two structurally-equal-but-distinct `securitySchemes` objects across two
  concurrent exports would need to be safe, which object-identity caching does not guarantee without
  care) for no real benefit over an explicit parameter — a violation of "No Silent Assumptions"
  (constitution XIV) for a problem an explicit argument solves for free.

## D3 — Variable-name derivation: one small pure stem function, reused by both naming and producer discovery

**Decision**: A single pure helper, `schemeStem(schemeKey)`, strips a trailing case-insensitive
`Auth` or `Scheme` suffix if present (else returns the key unchanged), per the 2026-09-15
clarification. `planSchemeVariables` uses it to build every non-primary key's variable name(s)
(`${stem}Token`, `${stem}ApiKey`, `${stem}Username`/`${stem}Password`). The producer-discovery pass
(D5) reuses the *same* stem value already stored on each plan entry, rather than recomputing it —
guaranteeing the string a QA engineer sees in the variable name (`{{adminToken}}`) is the exact same
string the producer heuristic searches for in candidate operations' paths/`operationId`s.

**Rationale**: Deriving the stem in exactly one place and threading it through both consumers is
what makes FR-003 (naming) and FR-006 (producer discovery) provably consistent with each other —
two independent implementations of "strip the suffix" could silently diverge (e.g. one handles
`Scheme` and the other doesn't) and produce a producer match that doesn't correspond to the variable
name actually emitted.

## D4 — `credentialVariable` gains an optional second parameter; existing call sites are untouched

**Decision**: `backend/src/postman/artifactVariables.ts`'s `credentialVariable(kind, variableName =
kind)` gains a second, optional parameter that overrides the emitted `ArtifactVariable.name` while
the first parameter continues to select the purpose text and secret-handling behavior via the
existing `CREDENTIAL_PURPOSE` table. Every existing call site (`requestItem.ts`'s sensitive-value
substitution, `authMapping.ts`'s existing single-scheme calls) keeps calling it with one argument and
is byte-for-byte unaffected.

**Rationale**: `requestItem.ts` calls `credentialVariable(kind)` for a wholly unrelated purpose —
replacing a literal-looking secret detected inside a request body/header field with a placeholder —
and always wants the variable literally named `token`/`apiKey`/`password`, never a scheme-derived
name; that detection has no concept of which security scheme (if any) governs the operation. Adding
an optional parameter (rather than changing the required signature, or adding a second exported
function) is the smallest change that lets `authMapping.ts` request `credentialVariable("token",
"adminToken")` for a distinct scheme's variable while leaving every unrelated call site's behavior,
and its own tests, unchanged.

**Alternatives considered**:
- *A second exported function, `schemeCredentialVariable(kind, variableName)`.* Rejected as pure
  duplication of `credentialVariable`'s body for no behavioral difference — an optional parameter
  says the same thing with one function instead of two.

## D5 — Producer discovery: a new, independently-testable pure module, not an extension of `automaticChaining.ts`

**Decision**: Add `backend/src/postman/credentialProducers.ts`, exporting one pure function,
`findCredentialProducers(operations, plan)`, implementing FR-006 exactly: for every non-primary
scheme entry in the plan, filter `operations` to those with `security.length === 0` (unauthenticated
— the existing signal `authMapping.ts` already uses for "no auth declared") whose `path` or
`operationId` contains that scheme's stem (D3) as a case-insensitive substring; a scheme with
exactly one such match yields one `CredentialProducerCandidate`, and a scheme with zero or several
matches yields none (FR-006's "MUST NOT guess" clause). Search scope is `apiModel.operations` — the
whole specification, per FR-006's literal wording — not only the operations present in the exported
`TestModel`'s approved scenarios.

**Rationale**: `automaticChaining.ts`'s `planAutomaticChains` solves a structurally different
problem — matching a *response field name* to a *path-parameter name* across `ApiDependencyGraph`
relationships computed by 008's schema-level analysis — and has no concept of "this operation
requires no auth" or "this scheme's key stem." Extending it to also do path/operationId substring
matching against security-scheme keys would mix two independent matching strategies (schema field
identity vs. document identifier text) into one module, a Separation of Concerns (constitution IX)
violation for a mechanism spec 019 already documents and tests as schema-field-driven. A new,
narrowly-scoped, five-line-body pure function is both the smaller change and independently unit-
testable in isolation from the dependency-graph machinery, matching the project's "prefer pure
functions, `operation → result`" convention (CLAUDE.md §11).

**Alternatives considered**:
- *Widen `ApiDependencyRelationship`/`planAutomaticChains` to also emit scheme-producer
  relationships.* Rejected: `ApiDependencyGraph` relationships are built entirely from response/
  request *schema field* matching (`deterministicMatching.ts`); a security-scheme key is not a
  schema field, so forcing it through the same relationship shape would require inventing a
  synthetic field to carry it, fabricating structure the existing dependency-analysis domain model
  does not have.

## D6 — Contract shape: an additive `ExportResult` field and one new `GenerationLimitationKind`, no README/UI rendering added

**Decision**: `packages/shared-domain/src/postmanArtifact.ts` gains one new exported type,
`CredentialProducerCandidate { schemeKey, variableName, producerOperationPath,
producerOperationMethod }`, and one new field, `ExportResult.credentialProducers:
CredentialProducerCandidate[]` (present, possibly empty — every existing caller/fixture that builds
an `ExportResult` object literal must add it, surfacing every place the type is constructed rather
than letting an optional field silently default). `GenerationLimitationKind` gains
`"unresolved-credential-producer"` for FR-007's case (an empty variable placeholder is still
emitted; this limitation records that no producer could be identified). Both frontend
`LIMITATION_HEADINGS` maps (`PostmanExportLimitations.tsx` and, if a second copy exists,
`readme.ts`) are `Record<GenerationLimitationKind, string>`, so TypeScript itself forces a heading
to be added for the new kind — no rendering logic is otherwise added for `credentialProducers`
beyond what the type checker requires.

**Rationale**: FR-009 is explicit that *wiring* a discovered producer's response value into the
variable is delivered by a separate, later extension to `automaticChaining.ts`'s consumer-location
support — this spec "defines the variable-naming and producer-identification contract that
mechanism must target" and "does not itself modify the chaining engine." A new, additive
`ExportResult` field is exactly that contract: a stable, typed place for the later chaining
extension to read "which operation, which scheme, which variable" from, without this spec needing
to guess at how that future mechanism will consume it (e.g. whether it renders a README note, a UI
badge, or an automatic extraction script). Adding speculative README/UI copy now, before the
consuming mechanism exists, would be exactly the kind of infrastructure-before-need constitution
XXVII warns against, and would invite wording questions (exactly what should the note say?) that no
FR or SC in the spec answers.

**Alternatives considered**:
- *Represent a found producer as a positive-case entry in `limitations` instead of a new field.*
  Rejected: `GenerationLimitation` is documented as "a recorded gap" (postmanArtifact.ts) — using it
  to report a *success* would overload its meaning and break the frontend's existing "no limitations
  recorded" success-state rendering (`PostmanExportLimitations.tsx`) for exports where every distinct
  scheme's producer was found.

## D7 — Producer discovery never runs for a distinct `basic` scheme (implementation-time addendum)

**Decision**: `findCredentialProducers` (`backend/src/postman/credentialProducers.ts`) skips every
non-primary plan entry whose `type` is `"basic"` — it only ever proposes a producer candidate for a
distinct `bearer` or `apiKey` scheme.

**Rationale**: `CredentialProducerCandidate.variableName` is one string, because a bearer token or
an API key is one obtainable value a login-shaped response plausibly returns. Basic authentication
has no such single value — it is a username/password pair the caller already knows going in, not
something a login *response* issues. Picking one of the two variables (e.g. always `username`) to
satisfy the single-`variableName` shape would assert a producer relationship the specification
gives no evidence for, which constitution I/XIV forbid. Neither spec.md nor its Clarifications
discuss a `basic`-scheme producer case — every worked example is a bearer token — so declining to
guess here is the conservative reading of FR-006 rather than a deviation from it. A distinct
`basic` scheme still gets its correctly-named, empty `{{...Username}}`/`{{...Password}}`
placeholders and an `unresolved-credential-producer` limitation exactly like any other
undiscoverable case (FR-007).
