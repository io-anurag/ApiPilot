# Feature Specification: AI Enhancement Viability on Local CPU Inference

**Feature Branch**: `013-ai-enhancement-viability`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User report — "When the user clicks on the Enhance with AI button, this step always fails / timeout", accompanied by backend logs showing `errorCategory: "TIMEOUT"`, `durationMs: 300808`, and the stage transitioning `active` to `skipped` while the HTTP request itself returned `200`.

## Context: Why This Specification Exists

The AI Enhancement stage of the guided test-generation workflow has never succeeded against a
real specification on the local provider. This is not an intermittent failure or a slow-hardware
edge case: as currently configured the stage **cannot** complete within its own time budget, on
the smallest realistic input, on the hardware the project targets.

Measurements were taken against `backend/tests/fixtures/openapi/valid.yaml` (Pet Store, 3
operations, 26 deterministic scenarios) using the shipped local-provider configuration.

| Observation | Measured value |
| --- | --- |
| Prompt size sent to the model | 22,095 characters / 5,845 tokens |
| Time to process the prompt before the first output token | ~94 seconds |
| Output generation rate | ~2.0 tokens/second |
| Output length the system asks the model to produce | 1,024 tokens |
| Implied time to produce that output | ~34 minutes |
| Time budget allowed before the attempt is abandoned | 5 minutes |

A controlled comparison isolating prompt framing from weight precision, using a short prompt so
that generation rate is measured independently of prompt-processing cost:

| Weight precision | Prompt framing | Rate | Stopped on its own? | Output quality |
| --- | --- | --- | --- | --- |
| Quantized *(shipped)* | Raw data *(shipped)* | 2.0 tok/s | No | Entirely off-task |
| Quantized | Conversational | 2.0 tok/s | No | Right format, wrong fields |
| Unquantized | Raw data | 8.0 tok/s | Yes | Unusable leading fragment |
| Unquantized | Conversational | 8.0 tok/s | Yes | Exactly the requested structure |

The shipped combination is the worst of the four on both speed and correctness. The best is
roughly four times faster, stops as soon as it has finished, and returns precisely the structure
the system asked for. **The model itself is adequate for this task; the way it is configured and
addressed is not.** This distinction matters: it means the remedy is to correct configuration and
prompt handling, not to select a different model.

Five defects combine to produce the failure. Each degrades the feature independently; together
they make success impossible.

1. **The model is never told it is being given an instruction.** The system sends a bare
   machine-readable data structure as the prompt. Instruction-tuned models require their own
   conversational framing to interpret input as a task. Without it the model treats the prompt as
   text to continue rather than a request to fulfil, and its "I have finished" signal becomes
   unreachable, so generation can only ever end by exhausting the output allowance. Measured
   output under the shipped configuration is not merely imperfect but unrelated to the task.

2. **The chosen weight precision is a pessimization.** The quantized weights selected to reduce
   footprint run four times slower than unquantized weights on the target hardware and produce
   materially worse output. The setting achieves the opposite of its evident intent.

3. **The system believes the model can accept four times more input than it actually can.**
   Usable input capacity is read from the tokenizer's advertised maximum (131,072 tokens) rather
   than the model's true positional limit (32,768 tokens). The resulting allowance (~390,000
   characters) exceeds any realistic specification, so the batching capability delivered by
   `011-ai-prompt-batching` never activates, every run is a single batch, and the batch-level
   progress delivered by `012-ai-enhancement-progress` therefore never appears. The same inflated
   figure miscalibrates the guard that exists to prevent an opaque low-level crash on oversized
   input.

4. **The output allowance and the time budget were never sized against each other or against the
   real workload.** The model was selected on evidence gathered from single-sentence prompts with
   a 256-token allowance, which recorded a 33% structured-output success rate. The enhancement
   workload is roughly 23 times that prompt size and 4 times that allowance. Nothing verifies
   that the requested work can fit the allowed time before the work begins.

5. **The prompt carries far more material than the task requires** — the complete expanded API
   model including every schema, plus every deterministic scenario already generated, both
   embedded verbatim. Prompt size dominates the cost, and most of the material is not needed to
   propose additional scenarios.

The user-facing consequence is a five-minute unexplained wait followed by an internal diagnostic
string. This specification covers both the underlying viability defects and the waiting and
failure experience, because fixing only one leaves the feature either invisibly broken or
honestly broken.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI enhancement can actually produce scenarios (Priority: P1)

A test engineer has uploaded an API specification and reviewed the deterministically generated
baseline. They click "Enhance with AI" expecting the local model to propose additional semantic
scenarios that deterministic rules cannot infer. The run completes, and scenarios that came from
the model appear in the review workspace alongside the deterministic ones, each still carrying
the provenance identifying it as AI-derived.

**Why this priority**: This is the feature's entire purpose. Every other story here improves how
an outcome is communicated; this one is the difference between the capability existing and not
existing. Today it does not exist.

**Independent Test**: Run the enhancement stage against a small real specification with the local
provider and confirm at least one validated, executable AI-derived scenario is added to the
review workspace within the configured time budget, with the deterministic baseline unaltered and
unreordered.

**Acceptance Scenarios**:

1. **Given** a specification whose planned work fits the configured time budget, **When** the user
   runs AI enhancement with the local provider, **Then** the stage reaches `complete` and
   AI-derived scenarios are present in the review workspace with AI provenance recorded.
2. **Given** the model has produced everything it intends to say, **When** it signals completion,
   **Then** generation stops at that point rather than continuing until the output allowance is
   exhausted.
3. **Given** a specification large enough to exceed the model's true input capacity, **When** the
   user runs AI enhancement, **Then** the work is split across multiple batches and each batch's
   input stays within the model's real limit.
4. **Given** an identical specification and identical configuration, **When** enhancement is run
   twice, **Then** both runs produce the same retained scenarios in the same order.

---

### User Story 2 - A run that cannot succeed says so immediately (Priority: P1)

A test engineer runs AI enhancement on a specification, or on hardware, where the work cannot fit
the configured time budget. Instead of consuming the entire budget and then reporting a timeout,
the system determines this up front and says so immediately, explaining what exceeded what and
what can be changed.

**Why this priority**: Equal to P1 because the current behaviour actively wastes the user's time
and misleads them. A retry after a timeout is offered as a reasonable next step, but under the
conditions that caused the timeout it is a guaranteed repeat of the same loss. Failing in seconds
with an explanation is strictly better than failing in minutes without one.

**Independent Test**: Configure a time budget smaller than the planned work requires, run
enhancement, and confirm the refusal arrives in seconds naming the constraint, with no inference
work started.

**Acceptance Scenarios**:

1. **Given** the planned work demonstrably cannot fit the configured time budget, **When** the
   user runs AI enhancement, **Then** the system refuses before starting inference and explains
   which limit was exceeded and by roughly how much.
2. **Given** such a refusal, **When** the user reads the message, **Then** it states what they can
   change to make the run viable rather than only reporting that a limit was hit.
3. **Given** a refusal occurred, **When** the workflow continues, **Then** the deterministic
   baseline remains fully intact and reviewable and the workflow advances exactly as it does for
   any other non-success outcome defined by `011-ai-prompt-batching`.

---

### User Story 3 - The wait is honest and interruptible (Priority: P2)

A test engineer starts a run expected to take a while. Rather than an unchanging label, they can
see which phase the system is in — preparing the model versus generating — how long it has been
running, and they can stop it if they no longer want to wait.

**Why this priority**: P2 because it does not determine whether the feature works, but it governs
whether a legitimately slow run is tolerable or feels like a hang. It matters most on the first
run, which silently absorbs a large one-time model download and load inside the same
undifferentiated wait.

**Independent Test**: Start a run and observe that the displayed state distinguishes preparation
from generation, that elapsed time advances, and that cancelling returns control promptly and
leaves the workflow consistent.

**Acceptance Scenarios**:

1. **Given** a run is starting and the model is not yet prepared, **When** the user watches the
   stage, **Then** preparation is shown as a distinct phase from generation, so a long first-run
   delay is attributable rather than mysterious.
2. **Given** a run is in progress, **When** the user watches the stage, **Then** elapsed time is
   visible and updating, for single-batch runs as well as multi-batch runs.
3. **Given** a run is in progress, **When** the user cancels it, **Then** the run stops, the user
   is told it was cancelled rather than that it failed, and the deterministic baseline remains
   intact and reviewable.
4. **Given** a run was cancelled or abandoned, **When** the user starts a new run, **Then** the new
   run is not delayed or degraded by resources still held by the previous one.

---

### User Story 4 - Failures explain themselves in the user's terms (Priority: P2)

When enhancement does not succeed, the user is told what kind of problem occurred and what to do
about it, in language that does not require reading the source code.

**Why this priority**: P2 because it applies to every non-success path, including those already
handled by earlier specifications. The current message exposes an internal diagnostic string that
names an implementation constant and offers no next step.

**Independent Test**: Trigger each distinct failure category and confirm each produces a
distinguishable, actionable message containing no internal identifier, file path, or
implementation constant.

**Acceptance Scenarios**:

1. **Given** the run did not finish in the available time, **When** the outcome is shown, **Then**
   the user is told the local model was too slow for this workload on this machine, and what would
   make it viable.
2. **Given** the model could not be prepared or is unavailable, **When** the outcome is shown,
   **Then** the user is told the AI capability is unavailable and why, distinctly from a slowness
   problem.
3. **Given** the model responded but its output could not be used, **When** the outcome is shown,
   **Then** the user is told the model returned unusable output, distinctly from both slowness and
   unavailability.
4. **Given** any of the above, **When** the user reads the message, **Then** it contains no
   internal error-class name, configuration variable name, file path, or raw diagnostic string.

---

### Edge Cases

- **A single operation is too large to fit the model's input capacity on its own.** It cannot be
  split further. The system must report that specific operation as un-enhanceable rather than
  failing the entire run or silently dropping it.
- **The first run must download the model.** A large one-time download must be attributable in the
  interface rather than appearing as an unexplained delay, and must not be charged against the
  generation time budget as though the model were slow.
- **The user cancels while a batch is mid-flight.** Work already retained from completed batches
  must be preserved and the outcome reported as cancelled, not as failure or partial failure.
- **Some batches succeed and later ones are refused as unviable.** This must resolve to the
  existing `partial` outcome, retaining what succeeded, not to a total failure.
- **The user navigates away and returns during a long run.** The run continues server-side and the
  interface must reattach to its current state, consistent with `012-ai-enhancement-progress`.
- **Configuration is internally inconsistent** — for example an output allowance unachievable
  within the configured time budget at any plausible rate. This must surface as a configuration
  problem rather than as a runtime timeout.
- **The model reports no usable capacity information.** The system must fall back to a
  conservative assumption rather than an optimistic one.
- **A configured weight precision performs far worse than the alternative on the host hardware.**
  The project must be able to detect and record this rather than shipping a setting whose effect
  is the opposite of its intent.

## Requirements *(mandatory)*

### Functional Requirements

#### Making the model usable

- **FR-001**: The system MUST present prompts to instruction-tuned local models using the
  conversational framing those models require, so input is interpreted as a task to perform rather
  than text to continue.
- **FR-002**: The system MUST allow generation to end as soon as the model signals it has
  finished, rather than always continuing until the output allowance is exhausted.
- **FR-003**: FR-001 and FR-002 MUST apply to every feature that requests inference — scenario
  enhancement, dependency analysis, single-scenario regeneration, and model benchmarking — so no
  caller is left on the defective path.
- **FR-004**: The system MUST continue to work with models that provide no conversational framing
  of their own, without failing and without silently mis-framing their input.

#### Respecting the model's real limits

- **FR-005**: The system MUST determine a model's usable input capacity from the model's true
  positional limit, not from an advertised tokenizer maximum that may exceed it.
- **FR-006**: When capacity cannot be determined, the system MUST assume a conservative capacity
  rather than an unbounded one.
- **FR-007**: Work MUST be split into batches whenever planned input exceeds the model's real
  usable capacity, so the batching behaviour specified by `011-ai-prompt-batching` engages in
  practice rather than only in principle.
- **FR-008**: The guard rejecting oversized input before it reaches the model MUST be calibrated
  against the same true capacity used for planning, so planning and enforcement cannot disagree.

#### Sizing the work to the budget

- **FR-009**: The system MUST reduce the material included in an enhancement prompt to what the
  task requires, rather than embedding the complete expanded API model and the complete
  deterministic baseline verbatim.
- **FR-010**: FR-009 MUST NOT remove information the model needs to keep proposals grounded in the
  specification; proposals MUST remain verifiable against the specification and MUST continue to
  be rejected when they are not.
- **FR-011**: The output allowance and the time budget MUST be defined such that the allowed
  output is achievable within the allowed time at the observed local generation rate.
- **FR-012**: Default configuration values MUST be internally coherent, and an incoherent
  combination MUST be reported as a configuration problem rather than surfacing later as a runtime
  timeout.
- **FR-013**: Default weight precision MUST be chosen on measured evidence of speed and output
  quality on the target hardware profile, and the evidence MUST be recorded, consistent with the
  project's requirement that model selection be an engineering decision.

#### Failing fast and honestly

- **FR-014**: Before starting inference, the system MUST estimate whether the planned work can
  complete within the configured time budget, and MUST refuse immediately when it demonstrably
  cannot.
- **FR-015**: A refusal under FR-014 MUST identify which limit was exceeded and by approximately
  how much, and MUST state what the user can change.
- **FR-016**: A refusal under FR-014 MUST leave the deterministic baseline fully intact and MUST
  resolve to the existing non-success stage semantics established by `011-ai-prompt-batching`,
  introducing no new terminal stage status.
- **FR-017**: When an attempt is abandoned because its time budget expired, the system MUST stop
  consuming machine resources for that attempt, so a subsequent attempt does not compete with work
  already given up on.

#### The waiting experience

- **FR-018**: The system MUST distinguish "preparing the model" from "generating" in what it
  reports, so a first-run preparation delay is attributable.
- **FR-019**: The system MUST show continuously updating elapsed time for a run in progress,
  including runs consisting of a single batch.
- **FR-020**: Users MUST be able to cancel a run in progress and regain control promptly.
- **FR-021**: A cancelled run MUST be reported as cancelled, distinctly from a failed run, and MUST
  preserve both the deterministic baseline and any AI-derived scenarios already retained.
- **FR-022**: Time spent preparing the model MUST NOT be counted against the generation time
  budget.

#### Explaining outcomes

- **FR-023**: Every user-facing failure message MUST distinguish at minimum: the model was too slow
  for this workload, the AI capability is unavailable, and the model returned unusable output.
- **FR-024**: User-facing messages MUST NOT expose internal error-class names, configuration
  variable names, file paths, or raw diagnostic strings.
- **FR-025**: Each failure message MUST state a next step the user can act on, and MUST NOT suggest
  an immediate retry when the same conditions would produce the same failure.
- **FR-026**: Full diagnostic detail MUST remain available in server-side logs, subject to the
  project's existing prohibition on logging specification content, prompts, and model responses.

#### Preserving established behaviour

- **FR-027**: AI enhancement MUST remain local-only. No cloud or external inference fallback may be
  introduced, and specification content MUST NOT leave the local machine.
- **FR-028**: Identical inputs and configuration MUST continue to produce identical retained
  scenarios in identical order.
- **FR-029**: AI-derived scenarios MUST continue to carry provenance identifying them as
  AI-derived, and MUST continue to be validated and deduplicated exactly as they are today.
- **FR-030**: The success / partial / skipped stage semantics from `011-ai-prompt-batching`, the
  live progress and concurrency guard from `012-ai-enhancement-progress`, and the retry rules for a
  non-successful stage MUST all be preserved.
- **FR-031**: An AI failure of any kind MUST never remove, alter, or reorder deterministically
  generated scenarios.

### Key Entities

- **Viability Estimate**: A pre-flight judgement about whether planned work can complete within the
  configured time budget. Comprises planned input size, requested output allowance, an assumed
  generation rate, the projected duration, and the budget compared against. Produced before any
  inference begins.
- **Run Phase**: The observable stage of a run, distinguishing preparing the model from generating,
  so elapsed time can be attributed to the correct activity.
- **Model Capacity**: The model's true usable input size, together with how it was determined and
  whether a conservative fallback was applied. Shared by batch planning and the oversized-input
  guard so the two cannot disagree.
- **Failure Explanation**: The user-facing account of a non-success outcome — its category, a
  plain-language description, and a concrete next step — kept deliberately separate from the
  internal diagnostic detail written to logs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: AI enhancement completes successfully against a small real specification on the
  local provider on ordinary developer hardware — an outcome the feature has never achieved.
- **SC-002**: A run that cannot succeed reports so within 10 seconds, rather than after the full
  time budget elapses.
- **SC-003**: Generation stops when the model has finished rather than always running to the output
  allowance, verified by observing completed responses shorter than the allowance.
- **SC-004**: A specification exceeding the model's real input capacity is processed as multiple
  batches with visible batch-level progress — the behaviour `011` and `012` specified but which has
  never been reachable in practice.
- **SC-005**: The time a user waits before learning the outcome of an unsuccessful run is reduced
  by at least 95% relative to the current five-minute silent timeout.
- **SC-006**: The proportion of enhancement attempts producing at least one usable AI-derived
  scenario rises from 0% to a level recorded as acceptable by measured evidence.
- **SC-007**: 100% of user-facing failure messages are classifiable by a non-developer into one of
  the distinct categories in FR-023, and none contains an internal identifier.
- **SC-008**: A user can abandon a run in progress and begin a different action within 5 seconds.
- **SC-009**: Running enhancement twice on identical input yields identical retained scenarios in
  identical order, in 100% of trials.
- **SC-010**: No deterministic scenario is lost, altered, or reordered by any AI outcome, in 100% of
  trials across success, partial, refusal, cancellation, and failure paths.
- **SC-011**: Abandoned runs no longer leave work consuming machine resources, verified by
  observing resource use return to baseline after a run is abandoned.

## Assumptions

- The default local model remains a small instruction-tuned model runnable on CPU without
  dedicated acceleration. Measurement indicates the current default model is adequate once
  addressed correctly, so replacing it is not anticipated; if evidence gathered during
  implementation contradicts this, model replacement is a separate decision under the project's
  model-selection principle.
- Generation rate varies substantially across machines. The viability estimate is therefore an
  approximation calibrated from observed local behaviour, not a precise prediction, and is expected
  to be conservative rather than optimistic.
- "Ordinary developer hardware" for SC-001 means a machine comparable to the one where the defect
  was measured: CPU-only, with no dedicated accelerator.
- Reducing prompt content (FR-009) may reduce the number or variety of proposals the model makes.
  Fewer grounded, verifiable proposals delivered reliably is preferable to more proposals that
  never arrive, consistent with the project's quality-over-quantity principle.
- Cancellation may not interrupt an in-flight low-level computation instantly. The requirement is
  that the user regains control promptly and that abandoned work stops consuming resources as soon
  as it is able to.
- Choosing unquantized weights increases the one-time model download and memory footprint. This
  trade is assumed acceptable because the quantized alternative was measured as both slower and
  less accurate, making the footprint saving a false economy; the trade-off is to be recorded
  explicitly.
- Existing deterministic generation, review, dependency analysis, and export capabilities are
  unchanged except where a shared inference path is corrected for all callers.
- The AI provider abstraction's role is unchanged: local and mock providers remain the only modes,
  and automated tests continue to default to the mock provider.

## Out of Scope

- Selecting or benchmarking a replacement default model, unless implementation evidence shows the
  current one cannot meet SC-001 once correctly addressed.
- Introducing hardware acceleration beyond the existing explicit accelerator option.
- Any cloud, hosted, or external inference path.
- Changing what makes a proposed scenario valid, executable, or grounded.
- Persisting workflows across server restarts.
- Test execution and results (`AP-011`) and AI failure analysis (`AP-012`), both post-MVP.

## Dependencies

- `004-ai-provider-local-inference` — the provider abstraction, readiness states, request queueing,
  and timeout behaviour corrected here.
- `005-ai-test-scenario-designer` — the enhancement prompt, candidate validation, and provenance
  this work must preserve.
- `011-ai-prompt-batching` — batch planning and the success / partial / failure outcome semantics
  this work must preserve and finally make reachable.
- `012-ai-enhancement-progress` — live progress reporting, the concurrency guard, and incremental
  review-workspace population, which this work extends to single-batch and preparation phases. This
  specification supersedes that feature's decision to hide progress entirely for single-batch runs,
  a case the capacity defect made universal.
