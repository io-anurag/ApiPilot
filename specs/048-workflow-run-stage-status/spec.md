# Feature Specification: Guided Workflow Run Stage Status

**Feature Branch**: `048-workflow-run-stage-status`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Guided workflow Execution and Performance Testing stage status: after the engineer continues from Postman Generation to Import & Run Collection, the Execution stage stays 'Active' and Performance Testing stays 'Not yet reached' forever, because nothing completes them. Execution should become Complete when a run of this workflow's own collection finishes; Performance Testing should become Complete when a run that comes from this workflow finishes, whatever its outcome. The tracker must reflect this without a reload."

## Background

The guided workflow ends with three Execute stages: Postman Generation, Execution and Performance Testing. Execution no longer has a screen of its own (specs/009, Clarifications 2026-09-20 and 2026-09-23): it hands the engineer over to Import & Run Collection with the generated collection pre-filled, and Performance Testing is opened in the Performance tab. Both runs happen outside the guided workflow, and the workflow is never told about them.

As a result the stage tracker keeps showing **Execution: Active — return** and **Performance Testing: Not yet reached — open**, however many runs the engineer has completed. Execution can only be completed through two API operations that no screen calls, and Performance Testing has no way to change status at all. The tracker therefore misreports a finished workflow as unfinished.

This feature lets a finished run of the workflow's own artifacts complete the corresponding stage. It adds no new screens, and it does not change which stages exist, their order, or how any run is started or reported.

## Clarifications

### Session 2026-10-12

- Q: Which performance runs should complete Performance Testing: only runs of a plan seeded from this workflow's Guided workflow source, or also runs of a plan built from the same specification outside the workflow? → A: Also plans created from the same specification as this workflow (FR-004 to FR-006, Story 2).
- Q: When the engineer cancels an Import & Run run of the workflow's collection, should Execution become Complete, or stay Active until a run finishes normally? → A: A cancelled run leaves Execution Active; only a run that ends without being cancelled completes it (FR-002, Story 1). This differs from Performance Testing, where a cancelled run still counts (FR-005).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Execution shows Complete once the generated collection has been run (Priority: P1)

An engineer generates the Postman collection, continues to Import & Run Collection, uploads the pre-filled collection and runs it. When the run ends without being cancelled, including a run that stopped on an error, the guided workflow shows Execution as Complete. A cancelled run does not complete it.

**Why this priority**: This is the reported defect. A workflow whose collection has been run still reads as "Active — return", so the engineer cannot tell whether the workflow is finished.

**Independent Test**: Generate a collection in a guided workflow, continue to Import & Run, upload the pre-filled collection, run it, then return to the guided workflow and read the Execution stage.

**Acceptance Scenarios**:

1. **Given** Execution is Active and the engineer has uploaded the collection that Continue to Import & Run pre-filled, **When** a run of that upload ends without being cancelled (including one that stopped on an error), **Then** Execution is shown as Complete.
2. **Given** the same state, **When** the run is still in progress, or the engineer cancels it, **Then** Execution remains Active.
3. **Given** the engineer is in Import & Run (the guided workflow is not on screen), **When** the run completes and the engineer goes back to the guided workflow, **Then** the tracker already shows Execution as Complete, with no page reload.
4. **Given** the workflow holds a generated collection and the engineer has also uploaded an unrelated collection, **When** a run of the unrelated collection finishes, **Then** Execution is unchanged.
5. **Given** Execution is Complete, **When** the engineer runs the collection again, **Then** Execution stays Complete.

---

### User Story 2 - Performance Testing shows Complete once a run from this workflow has finished (Priority: P2)

An engineer opens Performance Testing from the guided workflow, or builds a plan in the Performance tab from the same specification, and runs it. When the run finishes, whatever the outcome, the guided workflow shows Performance Testing as Complete.

**Why this priority**: Same defect as Story 1 for the optional last stage. It is lower priority because the stage is optional and the workflow can be finished without it.

**Independent Test**: With Postman Generation complete, create a plan from the guided workflow in the Performance tab, run it to a final state, then read the Performance Testing stage in the guided workflow.

**Acceptance Scenarios**:

1. **Given** Postman Generation is complete and a performance plan was seeded from this workflow or created from the same specification, **When** a run of that plan reaches a final state of any kind (passed, failed, cancelled or errored), **Then** Performance Testing is shown as Complete.
2. **Given** the same plan, **When** the run is still in progress, **Then** Performance Testing is not shown as Complete.
3. **Given** a performance plan created from a different specification, from a collection, or empty, **When** its run finishes, **Then** Performance Testing is unchanged.
4. **Given** Performance Testing is Complete, **When** the engineer starts another run, **Then** it stays Complete.

---

### User Story 3 - Status updates appear wherever the engineer is looking (Priority: P2)

The guided workflow stays loaded while the engineer works in Import & Run or Performance. The tracker must show the new status when they return, and also when the run finishes while they are watching a screen that shows the tracker.

**Why this priority**: Without it the status is correct on the server but looks stale until a reload, which brings back the original complaint.

**Independent Test**: Finish a run, switch to the guided workflow tab without reloading, and read the tracker and the stage chips.

**Acceptance Scenarios**:

1. **Given** a run finishes while the engineer is in Import & Run or Performance, **When** they open the guided workflow, **Then** the tracker, the stage chips and the step counter show the new status.
2. **Given** the guided workflow is open and a qualifying run finishes in the same session, **When** the engineer looks at the tracker, **Then** it shows the new status within 5 seconds without any action.
3. **Given** Execution and Performance Testing are both Complete, **When** the engineer opens the Execute group, **Then** it shows all of its stages done.

---

### Edge Cases

- The workflow is discarded, or a new one is started, before the run finishes: the finished run changes nothing in the new workflow.
- The pre-filled collection is uploaded more than once: a run of any upload created through the hand-off from this workflow counts, whichever generation of the collection it was made from.
- The engineer regenerates the Postman collection after Execution is Complete: existing rules for stages that depend on Postman Generation apply unchanged; this feature adds no rule of its own.
- A run is cancelled: it counts as a final state for Performance Testing, but not for Execution, which stays Active until a run ends without being cancelled.
- The engineer skips Execution through the API: a later Import & Run run does not undo it. A skipped Execution stays skipped; the only thing that reopens one is starting a run from the workflow's own execution operation, which this feature does not use.
- The session expires or the workflow no longer exists when the run finishes: nothing is changed and no error is shown to the engineer.
- A plan was created from the same specification, but the workflow was started from an earlier version of it that has since been replaced: the plan is not linked, because it no longer comes from the same specification.
- A performance plan was seeded from an earlier workflow that has since been discarded, but names the same specification title: it counts for the current workflow, because the recorded seed holds only the title.
- The engineer uploads the same collection file by hand, without using Continue to Import & Run: it is not linked to the workflow and does not complete Execution.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A collection uploaded through Continue to Import & Run Collection MUST be recorded as belonging to the guided workflow that generated it. A collection uploaded any other way MUST NOT be. The link is checked when a run finishes, against the session's current workflow, not when the upload is made.
- **FR-002**: When a run of a collection recorded under FR-001 ends without being cancelled (including a run that stopped on an error), the product MUST mark that workflow's Execution stage Complete if it is Active. A cancelled run MUST NOT.
- **FR-003**: A run of any other collection MUST NOT change any workflow stage.
- **FR-004**: A performance plan MUST be recognisable as belonging to a guided workflow when it was seeded from that workflow, or when it was created from the same specification the workflow was started from.
- **FR-005**: When a run of a plan recognised under FR-004 reaches a final state of any kind, the product MUST mark that workflow's Performance Testing stage Complete, provided Postman Generation is Complete.
- **FR-006**: A run of any other plan (a different specification, a collection, or an empty plan) MUST NOT change any workflow stage.
- **FR-007**: A run that is still in progress MUST NOT complete either stage, and a cancelled Import & Run run MUST NOT complete Execution.
- **FR-008**: Marking a stage Complete MUST be idempotent: a stage that is already Complete stays Complete, and later runs do not change its completion time.
- **FR-009**: An explicit skip of Execution MUST be respected: a finished Import & Run run MUST NOT change a skipped Execution stage. Only Execution that is Active is completed.
- **FR-010**: If the recorded workflow is no longer the session's current workflow when a run finishes, the product MUST leave the current workflow unchanged and MUST NOT report an error to the engineer.
- **FR-011**: The guided workflow MUST show the updated status without a page reload when the engineer returns to it, and while it is on screen MUST pick up a change made by a finishing run without any action from the engineer.
- **FR-012**: The stage tracker, its stage chips, the step counter and the group summaries MUST all derive from the same updated status, so none of them can disagree.
- **FR-013**: The behavior MUST be the same on every run: given the same sequence of uploads and finished runs, the resulting stage statuses are identical. Statuses depend on run outcomes recorded in the session, never on timing or on what is currently on screen.
- **FR-014**: Nothing about starting, running, reporting, cancelling or exporting a run, and no existing stage rule other than those named above, may change.
- **FR-015**: Workflow, upload and plan records and run results MUST stay in the session, as today. Nothing may be sent to an external service, and no run content (collection bodies, credentials, results) may be copied into the workflow record, only the fact that a qualifying run finished.

### Key Entities

- **Workflow link on an uploaded collection**: Records that an uploaded collection came from a particular guided workflow's generated artifact. Absent for collections uploaded any other way.
- **Workflow link on a performance plan**: Records that a plan was seeded from a particular guided workflow, or that it was created from the specification that workflow was started from. Already implied by the plan's source; this feature requires it to be reliably identifiable.
- **Run completion signal**: The fact that a run of a linked collection or plan reached a final state. It carries no run content.
- **Stage status**: The existing status of the Execution and Performance Testing stages (not yet reached, active, complete, skipped, stale), unchanged in meaning.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of runs of the Story 1 flow, the guided workflow shows Execution as Complete as soon as the run ends without being cancelled and the engineer is back on the guided workflow, with no reload.
- **SC-002**: In 100% of runs of the Story 2 flow, it shows Performance Testing as Complete after a final state of any kind.
- **SC-003**: No run of an unlinked collection or unlinked plan changes any stage status, in every combination covered by tests (unrelated upload, hand-uploaded copy, plan from a different specification, collection plan, empty plan).
- **SC-004**: While the guided workflow is on screen, a change made by a finishing run appears within 5 seconds with no action.
- **SC-005**: An engineer reading the tracker after finishing both runs can tell the workflow is finished without opening any other screen.
- **SC-006**: No existing test for starting, running, reporting or cancelling a run, or for other stage statuses, needs a changed expectation.

## Assumptions

- "A run of this workflow's own collection" means a run of an upload created by Continue to Import & Run from this workflow. Editing the uploaded collection's requests or variables before running does not break the link.
- "A run that comes from this workflow" for Performance Testing means a run of a plan seeded from the guided workflow (the Guided workflow source in specs/047), or of a plan created from the same specification the workflow was started from (confirmed 2026-10-12). Plans created from a different specification, from a collection, or empty are not linked. "The same specification" is the specification as the plan's recorded seed names it (planning, research D3): the uploaded file's name for a plan seeded from a specification, and the specification's title for a plan seeded from the workflow. No document content is compared, so two different documents with the same file name or title are treated as the same.
- An Import & Run run that ends without being cancelled completes Execution, whether or not its checks passed or it stopped on an error (the product records such a run as completed); a cancelled run does not (confirmed 2026-10-12). The stage means "the collection has been run to the end", not "the run passed". Performance Testing differs on purpose: any final state, including cancelled, completes it.
- The existing Complete status is used as is; no new status value and no new stage are introduced.
- Statuses already stored for a workflow that predates this feature are not rewritten retroactively; they change only when a later qualifying run finishes.
- This amends specs/009 (stage model and contracts), specs/026 (uploaded collection record), and specs/029 and specs/047 (performance plan source and run completion). The amendments are additive: no existing field, endpoint or status changes meaning.
- Changes stay uncommitted for the engineer to review.
