# Feature Specification: AI Enhancement Progress Visibility

**Feature Branch**: `012-ai-enhancement-progress`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Streaming/incremental progress reporting for the AI-assisted scenario enhancement stage (specs/011-ai-prompt-batching builds on this). Today, POST /api/test-generation-workflow/ai-enhancement runs all of enhanceTestModel's batches sequentially in-process and only responds once every batch has finished (or timed out), so for a specification that requires multiple AI batches the user stares at \"Enhancing...\" for the full duration with no visibility into progress, and when it finally resolves, the batching-outcome banner (success/partial/skipped) is the first signal they get — it reads to users as ambiguous/alarming even though the workflow always advances deterministically. We want the user to see live, incremental progress as each batch completes (e.g., \"batch 2 of 5 processing\", per-batch success/failure) while it runs, instead of one long silent wait followed by a single final outcome. This is a user-facing enhancement to the existing AI enhancement workflow stage — it must preserve today's guarantees: deterministic batching (FR-009 in 011-ai-prompt-batching), the existing success/partial/skipped outcome semantics, graceful fallback to deterministic-only scenarios when AI batches fail, and local-first/non-cloud AI processing. It should not change what batching computes, only how its progress is surfaced to the user while it runs."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live progress during a multi-batch enhancement run (Priority: P1)

A user runs "Enhance with AI" against a specification large enough that it requires several AI batches. Instead of a single unchanging "Enhancing…" label for the entire duration, the user sees which batch is currently being worked on and, as each batch finishes, whether it succeeded or failed — while the run is still in progress.

**Why this priority**: This is the core problem reported: users cannot tell whether anything is happening during a long wait, which makes a working system feel broken. Visibility during the wait is the primary value this feature adds.

**Independent Test**: Run AI enhancement against a specification whose operations are known to split into multiple batches. Confirm that, before the overall run finishes, the user can see the total batch count and the current batch being processed, and that this updates at least once per batch without the user manually refreshing.

**Acceptance Scenarios**:

1. **Given** a specification that requires 3 AI batches, **When** the user starts AI enhancement, **Then** the user sees an indication that 3 batches are involved and which one is currently being processed, updating as each batch starts.
2. **Given** a run in progress, **When** one batch finishes (successfully or not), **Then** the user sees that specific batch's result before the next batch starts or the overall run finishes.

---

### User Story 2 - An unambiguous final outcome (Priority: P1)

A user watches an AI enhancement run finish and wants to know, without doubt, whether the stage fully succeeded, partially succeeded, or did not succeed — and that the workflow has moved on with a known, well-defined set of scenarios either way.

**Why this priority**: Equally critical to User Story 1 — today's final banner is technically correct but is reported as reading like an unexplained error. Users must be able to tell the difference between "still working" and "finished, here is exactly what happened" at a glance.

**Independent Test**: Run AI enhancement to completion under each of: full success, partial success (some batches fail), and full failure (all batches fail). Confirm a user can correctly state which of the three occurred, and that deterministic scenarios are always present regardless of outcome, without inspecting logs or developer tools.

**Acceptance Scenarios**:

1. **Given** a run where every batch succeeds, **When** it finishes, **Then** the user sees a clearly positive, unambiguous "completed" status distinct from any in-progress or partial/failed state.
2. **Given** a run where some batches fail and some succeed, **When** it finishes, **Then** the user sees a status distinct from both full success and full failure, naming which parts succeeded.
3. **Given** a run where every batch fails, **When** it finishes, **Then** the user sees a status that clearly states AI enhancement did not contribute results, while confirming the deterministic scenarios are still available to continue with.

---

### User Story 3 - Small specifications feel exactly as fast as before (Priority: P2)

A user runs AI enhancement against a specification that completes in a single AI batch (today's common case). The addition of progress visibility must not make this already-fast path feel slower, noisier, or more complicated than it is today.

**Why this priority**: Protects the existing, already-satisfactory experience for the common case from regressing while the multi-batch experience improves (mirrors the equivalent protection for batching itself in specs/011-ai-prompt-batching).

**Independent Test**: Run AI enhancement against a specification known to complete in a single batch today. Confirm the total time to a final result and the information shown are unchanged from current behavior — no added delay, no misleading "batch 1 of 1" progress steps cluttering a run that was always a single step.

**Acceptance Scenarios**:

1. **Given** a specification whose enhancement completes in one batch, **When** the user runs AI enhancement, **Then** the user reaches the same final outcome in the same amount of time as today, without an unnecessary intermediate progress step being the only thing shown before the result.

---

### Edge Cases

- What happens when the AI provider is unavailable before any batch is attempted (e.g., not-loaded/unavailable state)? The user must see this reported immediately as the final outcome, not as a progress indicator for a run that never actually starts.
- What happens when the specification requires zero batches (no operations) or exactly one batch? Progress reporting must degrade to the existing single-step behavior with no observable change (mirrors specs/011-ai-prompt-batching's equivalent edge case).
- What happens if every batch fails? Progress must show each failure as it happens, and the final status must read as "not completed," never as a misleading partial success.
- What happens if the connection between the user's browser and the server is interrupted while a run is in progress (network drop, laptop sleep, tab closed)? The run must continue to completion on the server rather than being aborted; the final outcome must always be retrievable, though resuming live in-progress status on reconnect is not required (FR-007).
- What happens if the user tries to start a second AI enhancement run (e.g., clicks retry) while one is already in progress for the same workflow? The system must prevent a second concurrent run rather than starting one alongside the first.
- What happens if a user accepts, rejects, or edits a scenario revealed from an already-succeeded batch while later batches are still processing? Their decision must be preserved regardless of how later batches conclude (FR-012).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST indicate to the user, for the entire duration of an AI enhancement run, that the run is actively in progress rather than presenting an indeterminate or unchanging wait state.
- **FR-002**: For a run split into more than one batch, system MUST show the total number of batches and which batch is currently being processed, updating this as each batch starts, without requiring the user to manually refresh or re-request status.
- **FR-003**: For each batch, once it finishes, system MUST show whether that batch succeeded or failed (and, for a failure, a user-facing reason category consistent with today's existing error categories), visible before the overall run's final outcome is available.
- **FR-004**: System MUST NOT change the deterministic batch grouping, the AI-candidate validation/merge/deduplication rules, or the meaning of the existing success/partial/skipped outcomes defined in specs/011-ai-prompt-batching — this feature changes only how progress is communicated while those existing computations run, not what they compute.
- **FR-005**: For a specification whose AI enhancement completes in a single batch, the user-visible experience (total time to result, information shown) MUST be unchanged from today's behavior.
- **FR-006**: Once a run finishes, system MUST present exactly one unambiguous final status — fully completed, partially completed (naming what succeeded and what did not), or not completed (naming why) — visually and textually distinct from the in-progress state, so a user is never unsure whether the stage is still running, succeeded, partially succeeded, or failed.
- **FR-007**: If the connection carrying progress updates to the user is interrupted, or the browser tab is closed, while a run is in progress, the run MUST continue to completion on the server rather than being aborted. Live, in-progress status (current batch position, per-batch results as they happen) is only required to be visible to the browser tab/session that started the run; if that visibility is lost (tab closed, connection dropped, page navigated away), the system is not required to resume showing live progress on return, but MUST show the run's final outcome, exactly as today, once the user next views the workflow.
- **FR-008**: System MUST prevent a second AI enhancement run from starting for the same workflow while one is already in progress (e.g., a retry action is disabled or rejected until the current run reaches a final outcome).
- **FR-009**: When a batch succeeds, its AI-derived scenarios MUST become visible in the scenario review list as soon as that batch completes, rather than only after every remaining batch also finishes — a user reviewing results while later batches are still processing MUST see them appear incrementally rather than all at once at the very end.
- **FR-010**: Progress information shown to the user MUST NOT include raw AI prompts, model responses, or specification content beyond what is already exposed today (batch counts, operation/candidate identifiers, and outcome categories), consistent with the project's existing non-sensitive-observability conventions.
- **FR-011**: This feature applies to the AI-assisted scenario enhancement stage only; the AI-assisted dependency-detection pass introduced alongside batching in specs/011-ai-prompt-batching is unaffected and out of scope for this iteration.
- **FR-012**: Review decisions (accept/reject/edit) a user makes on scenarios revealed from an already-succeeded batch MUST be preserved even if a later batch in the same run subsequently fails or succeeds — incremental reveal MUST NOT discard or reset decisions already made on earlier-revealed scenarios.

### Key Entities *(include if feature involves data)*

- **Enhancement Run Progress**: The live state of one AI enhancement attempt while it is in progress — the total number of batches involved, which batch is currently being processed, and each already-finished batch's individual result (succeeded, or failed with a reason category). Distinct from the existing final run outcome (success/partial/skipped), which remains the authoritative result once the run finishes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: During any AI enhancement run that requires more than one batch, users can correctly identify which batch is currently being processed at any point while it runs, without waiting for the run to finish, in 100% of multi-batch runs.
- **SC-002**: After any AI enhancement run finishes, users can correctly state whether it fully succeeded, partially succeeded, or did not succeed — and that deterministic scenarios remain available regardless — without consulting logs or developer tools, in 100% of runs.
- **SC-003**: For specifications whose enhancement completes in a single batch, total time to a final result is unchanged from today's behavior in 100% of such runs.
- **SC-004**: For a multi-batch run, users see at least one progress update within the time it takes each individual batch to complete — never a single silent wait spanning the entire run with no intermediate signal.
- **SC-005**: A user who returns to the workflow after a run has finished — whether or not they watched it in progress — can, within a few seconds, tell exactly how it concluded (fully completed, partially, or not completed, and why).

## Assumptions

- This feature reuses the existing AI enhancement batching mechanism from specs/011-ai-prompt-batching unchanged; it adds visibility into that mechanism's existing per-batch execution rather than altering how batches are computed, validated, merged, or deduplicated.
- The existing success/partial/skipped final-outcome semantics and their user-facing messages remain the authoritative result; progress reporting is purely additive information shown alongside and before that final outcome.
- Progress detail is batch-level (batch counts, current batch, per-batch pass/fail); per FR-009, a succeeded batch's scenarios also become reviewable immediately rather than only at the end of the run.
- Live in-progress status is scoped to the browser tab/session that started the run (FR-007) — no new server-side persistence of an in-progress run's status is required beyond what already exists for the final outcome; this keeps the feature additive rather than requiring a durable "run progress" record.
- Existing retry rules (a retry is only permitted before scenario review has been finalized) are unchanged; this feature does not alter when a retry is allowed, only what is shown while a run — initial or retry — is in progress, and prevents overlapping runs (FR-008).
- The AI-assisted dependency-detection pass (also introduced in specs/011-ai-prompt-batching) is out of scope for this iteration; only the scenario-enhancement workflow stage is affected.
- No change to local-first AI processing: progress information originates entirely from the same local backend process already executing the batches, and nothing about this feature causes specification content or prompts to leave the local machine.
