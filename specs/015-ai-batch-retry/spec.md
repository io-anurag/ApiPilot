# Feature Specification: AI Enhancement Batch Retry

**Feature Branch**: `015-ai-batch-retry`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Manual per-batch retry for AI enhancement: allow a user to manually re-run a single failed batch from an AI Enhancement run (e.g. Batch 4: Failed) after the overall run has settled, without re-running the whole stage. A successful retry replaces only that batch's outcome/scenarios; all other batches' results (succeeded, failed, or not-attempted) are left untouched. This is scoped to the AI Enhancement stage's batches (specs/011-ai-prompt-batching, specs/012-ai-enhancement-progress, specs/013-ai-enhancement-viability, specs/014-ai-batching-policy) and should follow those specs' existing determinism, provenance, and explicit-failure conventions rather than introducing new ones."

## Clarifications

### Session 2026-09-08

- Q: Once every batch in a run has a terminal status of "succeeded" — some originally, some via later batch retries — should the AI Enhancement stage's own overall status automatically update to reflect that (e.g., from "Partially completed" to "Complete")? → A: Yes — the stage's aggregate status is recomputed from all batches' current terminal statuses after every batch retry, so a run can reach "Complete" purely through retries.
- Q: When a batch is retried more than once, should the system keep a record of each individual attempt, or only the most recent attempt's outcome for that batch? → A: Latest attempt only — a batch's record is overwritten each retry; only its current terminal status and reason are visible.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Retry only the batch that failed (Priority: P1)

A QA engineer runs AI Enhancement over a large specification. The run splits the specification into many batches, most of which succeed, but one batch fails because the local model was momentarily not ready. Today the engineer's only recourse is "Retry AI enhancement," which reprocesses every operation in the specification again, wasting the time already spent on the batches that succeeded. Instead, the engineer wants to retry only the one batch that failed.

**Why this priority**: This is the entire point of the feature. Without it, a one-batch failure in an otherwise-successful run still costs the user a full re-run, which is the exact problem statement.

**Independent Test**: Can be fully tested by settling a run with a mix of succeeded and retryable-failed batches, retrying one failed batch, and confirming only that batch's scenarios change while every other batch's scenarios and review decisions are untouched.

**Acceptance Scenarios**:

1. **Given** an AI Enhancement run has settled with batch 4 failed (retryable category) and all other batches succeeded, **When** the user retries batch 4, **Then** only batch 4's operations are resent to the AI provider, and on success its new scenarios are added to the review workspace without altering any other batch's scenarios or review decisions.
2. **Given** batch 4's retry succeeds and it was the only batch that had not already succeeded, **When** the user views the AI Enhancement stage afterward, **Then** batch 4's status shows "Succeeded," the stage's overall status updates from "Partially completed" to "Complete," and no other batch is re-triggered.
3. **Given** batch 4's retry fails again with a retryable category, **When** the retry completes, **Then** batch 4's status still shows "Failed" with the new failure's reason, and no scenario or decision belonging to any other batch is affected.

---

### User Story 2 - See which batches failed and why, after the run has settled (Priority: P1)

A QA engineer needs to decide which of several failed batches are worth retrying. To do that, the failure reason for each batch must still be visible after the run ends — today, per-batch detail (which batch failed, and why) is only shown live while a run is in progress and disappears the moment the run settles.

**Why this priority**: User Story 1 is not achievable without this — a user cannot choose to retry "batch 4" if the system no longer remembers that batch 4 failed, or why, once the run has settled.

**Independent Test**: Can be fully tested by letting a run settle with a mix of outcomes, reloading/revisiting the AI Enhancement stage, and confirming every batch's terminal status and (for failed/not-attempted batches) failure reason are still visible.

**Acceptance Scenarios**:

1. **Given** a run has settled with some batches succeeded, one failed, and some not attempted (run time limit reached), **When** the user views the AI Enhancement stage, **Then** every batch's terminal status is shown, and the failed and not-attempted batches each show a human-readable reason.
2. **Given** a batch's failure reason is not retryable (e.g., that batch's content could not fit within the provider's request limits), **When** the user views that batch, **Then** no retry action is offered for it, and the reason makes clear why retrying would not help.

---

### User Story 3 - Retry is unavailable once scenario review has moved on (Priority: P2)

A QA engineer has already finalized scenario review and advanced to a later stage of the workflow. They should not be able to reach back and retry a batch, which would risk inserting new AI scenarios after the user has already signed off on the reviewed set — the same rule that already governs whole-stage retry.

**Why this priority**: Protects an existing, already-relied-upon guarantee (finalized review is final). Lower priority than Stories 1–2 because it is a guardrail on the new capability, not the capability itself.

**Independent Test**: Can be fully tested by finalizing scenario review, then confirming no batch retry action is offered or accepted for the prior AI Enhancement run.

**Acceptance Scenarios**:

1. **Given** scenario review has been finalized and the workflow has advanced past it, **When** the user looks back at the settled AI Enhancement run, **Then** no batch offers a retry action.
2. **Given** a batch retry is somehow requested after finalization, **When** the system processes the request, **Then** it is rejected and no scenario is added.

---

### Edge Cases

- What happens if the user requests a retry for a batch that already succeeded? The system MUST reject it — retry is only offered for batches whose terminal status is failed or not-attempted.
- What happens if the user requests a retry for a batch whose failure category is not retryable (e.g., its content was too large for the provider, or the run's overall time budget was already exhausted for reasons unrelated to that batch)? The system MUST reject it, consistent with the same category-based retryability rule already used for whole-stage retry.
- What happens if the user tries to retry a batch while another retry (of any batch) or a whole-stage run is already in progress? The system MUST reject the second request rather than running two AI operations concurrently against the same workflow.
- What happens if the workflow's specification or AI configuration changed after the original run but before the retry (e.g., a server restart with different settings)? The retried batch MUST still be sent using the exact set of operations it contained in the original run, not a set recomputed under the new configuration.
- What happens to a batch that was never attempted because the run's overall time budget was exhausted first? It is treated the same as a failed batch for retry purposes: retryable, since nothing about its own content caused it to be skipped.
- What happens to review decisions (approve/reject/edit) already recorded on scenarios from batches other than the one being retried? They MUST remain exactly as the user left them.
- What happens to deterministically generated scenarios during any batch retry? They MUST never be added, removed, altered, or reordered by a batch retry, exactly as during any other AI Enhancement operation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST retain, for every batch of a settled AI Enhancement run, a record of that batch's terminal status (succeeded, failed, or not-attempted) and, for failed or not-attempted batches, a human-readable failure reason — visible for as long as that run's outcome is visible, not only while the run is actively in progress.
- **FR-002**: The system MUST let a user manually trigger a retry of one specific batch whose terminal status is failed or not-attempted and whose failure reason is classified as retryable, using the same retryable/non-retryable classification already established for whole-stage retry (specs/013-ai-enhancement-viability).
- **FR-003**: The system MUST NOT offer or accept a retry request for a batch whose terminal status is succeeded, or whose failure reason is classified as non-retryable.
- **FR-004**: A successful batch retry MUST add only the scenarios newly produced for that batch's own operations into the review workspace; it MUST NOT modify, remove, or reorder any scenario, or any review decision on a scenario, that belongs to any other batch.
- **FR-005**: An unsuccessful batch retry MUST overwrite that batch's own recorded terminal status and failure reason with the new attempt's outcome, discarding no other batch's record; it MUST NOT change any other batch's recorded status or reason, and MUST NOT add or remove any scenario. No history of the batch's earlier attempts is retained.
- **FR-006**: The system MUST NOT allow a batch retry once scenario review has been finalized and the workflow has advanced past it, matching the existing rule for whole-stage AI enhancement retry.
- **FR-007**: The system MUST NOT allow a batch retry to start while another AI Enhancement operation (a whole-stage run, or a retry of any batch) is already in progress on the same workflow.
- **FR-008**: A batch retry MUST use exactly the same set of operations that batch contained in the run it belongs to, even if specification or AI configuration affecting batch composition has changed since that run.
- **FR-009**: Deterministically generated scenarios MUST remain completely unaffected by any batch retry, in all outcomes.
- **FR-010**: Scenarios produced by a batch retry MUST carry the same provenance and explainability guarantees already required of any AI-derived scenario (specs/011-ai-prompt-batching, specs/013-ai-enhancement-viability), and MUST additionally be identifiable as belonging to their originating batch, so that a later retry of that same batch can be scoped correctly.
- **FR-011**: The system MUST present a retry action distinctly per eligible batch (not a single all-or-nothing control), so a user can act on one batch without affecting the others.
- **FR-012**: After any batch retry settles, the system MUST recompute the AI Enhancement stage's overall status from the current terminal status of every batch in the run, so the stage-level status always reflects the batches' latest outcomes (e.g., a run reaches "Complete" once every batch's terminal status is succeeded, however many retries that took).

### Key Entities

- **Batch Outcome Record**: The persisted, per-batch result of one AI Enhancement run, kept for the life of that run's visible outcome (not cleared once the run settles). Represents a batch's identity, its operations, its terminal status, and — for failed or not-attempted batches — a human-readable, retryability-classified failure reason. Holds only the latest attempt for that batch: each retry overwrites the batch's own record in place rather than appending a new entry, so no history of earlier attempts is kept.
- **AI Scenario Provenance (extended)**: The existing explainability record already attached to every AI-derived scenario, extended with an association back to the batch that produced it, so scenarios can be found, and replaced, on a per-batch basis.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a run with several batches where only some failed, a user can retry a single failed batch and see its outcome resolve without waiting for, or re-running, any batch that already succeeded.
- **SC-002**: 100% of batch retries leave every review decision already recorded on another batch's scenarios unchanged.
- **SC-003**: For every settled AI Enhancement run, a user can see which batches failed and why without needing to start any new run.
- **SC-004**: Retry is never offered for a batch whose failure reason is non-retryable or whose status is already succeeded.
- **SC-005**: Once scenario review has been finalized, no batch retry action is reachable for a prior AI Enhancement run.
- **SC-006**: A run whose every batch eventually succeeds — whether on the first attempt or through later retries — is always shown as fully complete, never stuck showing a partial or incomplete label.

## Assumptions

- The platform's existing single-workflow, in-memory session model (no run history across restarts) is unchanged by this feature: batch outcome records persist only as long as the workflow itself does today, and are lost together with the rest of the workflow if the server restarts. This feature does not introduce durable storage.
- There is no limit on how many times a single batch may be retried; each retry simply re-evaluates that batch independently, the same as whole-stage retry has no attempt limit today.
- A batch retry reuses the existing exact-match scenario deduplication already used when merging a run's new scenarios into the review workspace; it does not introduce a new cross-batch content-similarity comparison. This is a known limitation shared with today's whole-stage retry and is not being expanded here.
- "Not-attempted" batches (skipped only because the run's overall time budget was exhausted, not because of anything about their own content) are treated as retryable, consistent with them not having failed on their own merits.
- Retrying a batch is available only once the run has settled (i.e., is no longer actively in progress); this feature does not add a way to intervene in a batch while its parent run is still running.
- This feature applies to any settled run outcome in which at least one batch's own terminal status is failed or not-attempted with a retryable reason, regardless of the run's overall aggregate outcome label — a batch's eligibility is decided from its own recorded status and reason, not from the run's aggregate outcome.
