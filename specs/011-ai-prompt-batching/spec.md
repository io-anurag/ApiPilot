# Feature Specification: Bounded AI Prompt Batching for Large Specifications

**Feature Branch**: `011-ai-prompt-batching`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "The real fix is a spec-level change to bound/chunk what gets sent to the model (e.g., splitting large ApiModels into smaller batches of operations per AI call) so AI-assisted dependency detection and AI-assisted test scenario enhancement don't get skipped for large OpenAPI specifications whose full ApiModel exceeds the configured AI provider's usable context capacity."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - AI-assisted analysis completes for large specifications (Priority: P1)

A user uploads a large OpenAPI specification (many operations) and runs the test generation workflow. Today, AI-assisted dependency detection and AI-assisted scenario enhancement are silently skipped for such specifications because the full specification does not fit in a single AI request. The user wants these AI-assisted passes to actually run and contribute results, instead of always falling back to deterministic-only output.

**Why this priority**: This is the entire purpose of the feature — without it, AI enhancement is unusable for any specification above a certain size, which defeats the product's core value proposition for exactly the specifications where AI assistance matters most (larger, more complex APIs).

**Independent Test**: Run AI-assisted dependency detection and AI-assisted scenario enhancement against a specification whose full set of operations is known to exceed the AI provider's usable capacity in a single request. Confirm the workflow no longer reports the request as too large, and that AI-derived relationships/scenarios are present in the result.

**Acceptance Scenarios**:

1. **Given** a specification whose full set of operations does not fit in a single AI request, **When** AI-assisted dependency detection runs, **Then** the system divides the specification's operations across multiple smaller AI requests and merges the results, rather than reporting the request as too large and falling back to deterministic-only relationships.
2. **Given** the same oversized specification, **When** AI-assisted scenario enhancement runs, **Then** AI-derived scenarios appear for operations across the whole specification (not just an arbitrarily truncated subset), each still carrying the same explainable provenance as today (source, rationale, confidence).

---

### User Story 2 - Small specifications behave exactly as before (Priority: P1)

A user works with a specification that already fits comfortably within a single AI request (today's common case). The introduction of batching must not change the behavior, timing characteristics, or output for these specifications.

**Why this priority**: Equal in priority to User Story 1 — batching is a scaling mechanism, not a behavior change for existing, already-working specifications. Regressing today's working case would be unacceptable even if large-specification support improves.

**Independent Test**: Run AI-assisted dependency detection and AI-assisted scenario enhancement against a specification already known to complete successfully today. Confirm exactly one AI request is issued and the results are unchanged.

**Acceptance Scenarios**:

1. **Given** a specification whose full set of operations fits in a single AI request, **When** either AI-assisted pass runs, **Then** exactly one AI request is issued for that pass, identical to current behavior.

---

### User Story 3 - Partial AI results are reported honestly (Priority: P2)

A user runs AI-assisted analysis against a large specification. One or more of the smaller AI requests the system splits the specification into fails (times out, or the AI provider becomes unavailable partway through), while others succeed. The user wants to know that AI enhancement was partially applied, and still receive the results that did succeed, rather than losing everything or seeing an unclear status.

**Why this priority**: Important for trust and explainability once batching exists, but the feature already delivers its core value (User Story 1) even with an all-or-nothing per-batch failure model; refining the reported outcome for partial failure is a secondary, additive improvement.

**Independent Test**: Force one of several batches for a large specification to fail (e.g., simulate a provider timeout on one batch only) while the others succeed. Confirm the successful batches' results are present in the output and the reported AI outcome distinguishes "fully completed," "partially completed," and "not completed at all."

**Acceptance Scenarios**:

1. **Given** a large specification split into multiple batches, **When** at least one batch succeeds and at least one batch fails, **Then** the results from successful batches are retained and the workflow reports a partial outcome distinct from full success and full failure.
2. **Given** the same scenario, **When** the user views the workflow status, **Then** the message explains that AI enhancement partially completed and identifies that some results may be missing, consistent with the project's existing non-silent-failure conventions.

---

### Edge Cases

- What happens when a single operation (one entry in the specification) is, by itself, already too large to fit in one AI request even alone? The system must not enter an infinite splitting loop; it should treat that single operation as a batch of one, let it fail via the existing oversized-request handling, and continue with the remaining operations rather than aborting the whole analysis.
- What happens when the specification has zero operations, or exactly one operation? Batching must degrease to the existing single-request (or no-request) behavior with no observable change.
- What happens when every batch fails? The reported outcome must be identical in meaning to today's full-skip outcome (deterministic-only results, explicit reason surfaced) — batching must not make a total failure look like a partial success.
- What happens when the AI provider is swapped for a different, larger- or smaller-capacity model between runs? The batch split must be computed from the currently configured provider each run, not cached from a prior run.
- How does the system behave if computing batches itself takes non-trivial time for a very large specification? The batching step must not become a new unbounded performance bottleneck; it must fit within the same overall analysis time budget the feature already respects today (e.g., dependency analysis's existing 15-second budget).
- What happens if two different runs of the same specification against the same provider produce different batch groupings? This must not happen — batching must be deterministic and reproducible.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST determine, before issuing an AI request for dependency detection or scenario enhancement, whether that request would exceed the configured AI provider's usable capacity.
- **FR-002**: When a request would exceed the provider's usable capacity, system MUST divide the specification's operations into multiple smaller batches such that each batch's resulting request fits within that capacity, instead of sending one oversized request that is rejected or skipped.
- **FR-003**: System MUST issue AI requests for a specification's batches one at a time (not concurrently), preserving the existing single in-process request ordering behavior used for all other AI requests.
- **FR-004**: System MUST include every operation from the specification in exactly one batch — no operation may be omitted, silently dropped, or duplicated across batches.
- **FR-005**: System MUST merge AI-derived results (relationships for dependency detection, scenarios for enhancement) from all successfully completed batches with the deterministic baseline, applying the same validation, deduplication, and provenance rules used today for a single AI request.
- **FR-006**: System MUST behave exactly as it does today when a specification's full set of operations already fits within a single AI request: exactly one AI request is issued, and results are unaffected by the introduction of batching.
- **FR-007**: When one or more batches fail (provider unavailable, timeout, or invalid output) while at least one other batch succeeds, system MUST retain the successfully merged results from the batches that succeeded rather than discarding them, and MUST report an outcome that is explicitly distinguishable from both "fully completed" and "not completed at all."
- **FR-008**: When every batch for a specification fails, system MUST report an outcome equivalent in meaning to today's single-request failure outcome (deterministic-only results with an explicit, user-visible reason) — batching MUST NOT be observable to the user as a different kind of total failure.
- **FR-009**: System MUST produce the same batch grouping (same operations grouped together, same order) for the same specification and the same provider configuration on every run — batching MUST be deterministic (constitution: Determinism First).
- **FR-010**: System MUST NOT let batch splitting or the resulting multiple AI requests exceed the overall performance budget that already applies to the analysis being enhanced (e.g., dependency detection's existing 15-second analysis budget); once that budget is exhausted, remaining unprocessed batches MUST be treated as not completed and reported per FR-007/FR-008 rather than allowed to run unbounded.
- **FR-011**: When a single operation is, by itself, already too large to fit within the provider's usable capacity, system MUST treat it as its own one-operation batch, let that batch fail through the existing oversized-request handling, and continue processing the remaining batches rather than aborting the entire analysis.
- **FR-012**: System MUST re-derive the batch split from the AI provider actually configured for the current run — a batch grouping computed for one provider MUST NOT be reused for a different provider.

### Key Entities _(include if feature involves data)_

- **Batch**: A subset of a specification's operations (and any other context sent to the AI provider today, e.g. the deterministic baseline for enhancement) grouped together to form one AI request; every operation belongs to exactly one batch for a given analysis run.
- **Batch Outcome**: The per-batch result of attempting an AI request — succeeded, failed with a specific reason, or not attempted because the overall time budget was exhausted.
- **AI Pass Outcome**: The aggregate result across all batches for one analysis run — fully completed (every batch succeeded), partially completed (at least one succeeded and at least one did not), or not completed (no batch succeeded) — surfaced to the user in place of today's single success/skip outcome.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: AI-assisted dependency detection and AI-assisted scenario enhancement complete successfully (fully or partially, per FR-007) for specifications that are today always skipped for being too large, without any manual configuration change from the user.
- **SC-002**: For specifications that already succeed today in a single AI request, output and pass/fail outcome are unchanged in 100% of cases after this feature ships.
- **SC-003**: Users are never shown a misleading "AI enhancement succeeded" or "AI enhancement failed" status when the true outcome is partial — the partial case is visibly distinguishable in the workflow status in 100% of affected runs.
- **SC-004**: Batching a given specification against a given AI provider configuration produces an identical batch grouping across repeated runs, verified with no variation across at least 10 repeated runs of the same input.
- **SC-005**: Introducing batching does not cause dependency detection to exceed its existing 15-second analysis budget any more often than it does today for specifications that already fit in a single request.

## Assumptions

- The AI provider abstraction can expose, or be configured with, enough information to estimate whether a given batch's request will fit within its usable capacity before sending it; the exact mechanism (a configured limit, a provider-reported capacity, or an estimation heuristic) is a planning-level decision, not specified here.
- "Usable capacity" refers to whatever limit already causes today's oversized-request rejection (the AI provider's context window, minus any reserved output/generation budget) — this feature does not change what counts as oversized, only what the system does before hitting that limit.
- Splitting a specification into batches by operation is an acceptable granularity (i.e., a single operation is never itself split further); the existing per-operation deterministic relationship/scenario model already treats operations as the natural unit of work.
- The existing mock AI provider (used in automated tests) is either exempt from batching (since it has no real capacity limit) or trivially reports "everything fits," so automated tests continue to run fully offline without requiring a real model (constitution: Local-First AI, deterministic testing).
- Existing provenance, validation, deduplication, and error-category conventions (established for dependency detection and scenario enhancement) are extended to a multi-batch run rather than replaced.
- This feature does not change which specifications are analyzed deterministically (the deterministic baseline is unaffected); it only changes how the optional AI-assisted pass is requested.
