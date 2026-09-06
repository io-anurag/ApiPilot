# Feature Specification: AI Batching Policy and Run Pacing

**Feature Branch**: `014-ai-batching-policy`

**Created**: 2026-09-06

**Status**: Draft

**Input**: Exploratory QA session against a real springdoc-generated specification (6 operations) and a synthesised large specification (200 operations), which found that AI enhancement contributes no scenarios at any specification size — and that the amount it can contribute *shrinks* as a specification grows.

## Context: Why This Specification Exists

`011-ai-prompt-batching` introduced request batching so that AI-assisted work could run against
large specifications instead of being skipped. `012-ai-enhancement-progress` added per-batch
progress reporting. `013-ai-enhancement-viability` sized the prompt and the output allowance so a
request could finish inside its time budget.

All three assumed that a realistic specification would be split into several batches. Measurement
shows it is not: batches are sized to *fill the model's context window*, and a realistic
specification fits. The result is one enormous request per run, which defeats each of those three
features in turn — there is nothing to stream, nothing to show progress for, nothing to cancel
between, and nothing retained when it fails.

### Measured behaviour (shipped default configuration, `Qwen2.5-0.5B-Instruct`, CPU)

| Input | Batches | Prompt size | Max AI scenarios obtainable | Deterministic scenarios | Observed / projected outcome |
| --- | --- | --- | --- | --- | --- |
| 6 operations | 1 | ~3,500 chars | 3 | 32 | `INVALID_RESPONSE` after ~57s of generation |
| 200 operations | 2 | ~62,000 chars (~20,700 tokens) each | 6 | 1,350 | ~91s projected per request against a 60s per-request limit — `TIMEOUT`, nothing retained |

Three compounding causes:

1. **Batches are sized by remaining context capacity, not by the work in one request.** Splitting
   only occurs once a prompt exceeds the input budget (~96,960 characters for the default model).
   Because the prompt asks for "at most 3 candidates" per request, the ceiling on AI contribution
   is *per batch* while batch count is governed by context size — so a 200-operation specification
   is capped at 6 AI scenarios, and the ratio of AI help per operation falls as specifications grow.

2. **One oversized request is also one oversized failure.** With a single batch the per-batch
   progress list is deliberately hidden (`totalBatches <= 1`), cancellation — which is only checked
   at batch boundaries — cannot take effect (measured: a cancel requested at 4 seconds settled after
   56 seconds), and a failure discards the entire run's work rather than part of it.

3. **The model echoes the request instead of answering it.** Captured raw output restates the
   prompt's own `responseVersion` / `task` / `operations` keys rather than emitting the expected
   candidate list, then truncates mid-document at the output cap. The response is rejected after
   roughly a minute of generation. The failure is deterministic under greedy decoding, yet the user
   is told it "can happen intermittently" and offered a retry that spends another minute reaching
   the identical outcome.

Additionally, `estimateViability` and the `not-viable` failure explanation — the pre-flight refusal
built by `013-ai-enhancement-viability` — are implemented but called from nowhere in the backend, so
work that cannot possibly finish is still attempted and still consumes its full budget.

### The same cause affects dependency analysis

Scenario enhancement is not the only caller. The AI-assisted pass of dependency analysis shares the
same operation-splitting behaviour and therefore has the same defect: a realistic specification
becomes one oversized request. Measured on a 6-operation specification, that request overran by more
than 3x and contributed no relationships, leaving dependency analysis deterministic-only in practice.
It also produced the single-unit blind spot that crashed the backend during the same QA session —
with only one unit, a run can never record a *skipped* unit, so the graceful degradation the design
depends on could not engage. (That crash and its budget guard were fixed separately; the structural
cause — one unit per run — is what this feature addresses.)

This specification therefore covers both AI-assisted passes, with unit size tuned per caller: the two
have genuinely different needs, since enhancement reasons about one operation at a time while
dependency analysis infers relationships *between* operations and needs enough of them in view to do
so.

### Constitutional framing

This feature is squarely within **XII (Quality Over Quantity)** — the goal is useful AI
contribution per unit of time, not more requests — and **XXX (Explicit Trade-offs)**, since batch
size trades throughput against per-request reliability. It must preserve **II (Deterministic Before
AI)**, **XIX (Fail Safely)**, **XXIII (Version AI Contracts)** if the prompt shape changes, and
**XXIV (Reproducibility)**.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI enhancement actually contributes scenarios (Priority: P1)

A QA engineer uploads a specification, generates the deterministic baseline, and runs AI
enhancement. Instead of waiting about a minute and being told the output could not be used, they
receive AI-suggested scenarios that reference real operations in their specification, and the
number of suggestions is proportionate to the size of the specification rather than capped at a
handful.

**Why this priority**: Without this the feature delivers nothing at all, at any specification size.
Every other story in this specification improves an experience that currently has no successful
outcome to improve.

**Independent Test**: Run enhancement against a small real specification and confirm that AI-derived
scenarios appear in the review workspace with `AI` provenance; repeat against a substantially larger
specification and confirm the count scales with operation count rather than staying flat.

**Acceptance Scenarios**:

1. **Given** a specification of roughly six operations, **When** the user runs AI enhancement to
   completion, **Then** at least one AI-derived scenario is added to the review workspace and every
   added scenario references an operation, parameter, field, and status code that exists in the
   specification.
2. **Given** a specification roughly thirty times larger, **When** the user runs AI enhancement,
   **Then** the number of AI-derived scenarios offered grows with the number of operations rather
   than remaining at the small specification's ceiling.
3. **Given** any specification, **When** enhancement finishes, **Then** every deterministic scenario
   present before the run is still present afterwards, unchanged.
4. **Given** a batch whose reply cannot be used, **When** the run continues, **Then** only that
   batch's contribution is lost and the remaining batches still contribute.

---

### User Story 2 - A long run is visible and can be stopped promptly (Priority: P2)

A QA engineer starts enhancement on a large specification, sees continuous evidence of progress,
decides partway through that they have enough, and stops the run — keeping everything produced so
far.

**Why this priority**: Turns an opaque multi-minute wait into an interruptible, observable one. The
underlying progress, streaming, and cancellation machinery already exists; this story is about the
batching policy making it functional rather than building it.

**Independent Test**: Start a run against a large specification, observe scenarios and batch
progress appearing incrementally, cancel mid-run, and confirm the run settles quickly with the
already-generated scenarios retained and reviewable.

**Acceptance Scenarios**:

1. **Given** a run in progress on a specification with more than one batch of work, **When** the user
   observes the screen, **Then** completed and outstanding units of work are both visible and update
   as the run proceeds.
2. **Given** a run in progress, **When** the user requests cancellation, **Then** the run settles
   within approximately the duration of a single unit of work rather than the duration of the whole
   run.
3. **Given** a cancelled run, **When** it settles, **Then** every scenario generated before
   cancellation remains in the review workspace and the outcome is presented as cancelled rather
   than as a failure.
4. **Given** a run where some units succeeded and others failed, **When** the run settles, **Then**
   the outcome is reported as partial and the successful units' scenarios are retained.

---

### User Story 3 - A large specification finishes within a predictable ceiling (Priority: P2)

A QA engineer runs enhancement on a very large specification. Rather than the run either failing
wholesale or continuing indefinitely, it works through as much as it can within a known time
ceiling, then stops and hands over what it produced.

**Why this priority**: Work-bounded batching makes total run time grow with specification size. Left
unbounded, a very large specification would run for an impractical length of time; this story is what
keeps the first story's fix from creating a new problem.

**Independent Test**: Run enhancement against a specification large enough that the full set of units
cannot complete inside the ceiling, and confirm the run settles as partial at the ceiling with
results retained and remaining work reported as not attempted.

**Acceptance Scenarios**:

1. **Given** a specification whose enhancement work exceeds the run ceiling, **When** the ceiling is
   reached, **Then** the run stops starting new units, settles as partial, and retains everything
   already produced.
2. **Given** a run that settles at the ceiling, **When** the user reads the outcome, **Then** they
   are told how much of the planned work completed and that the remainder was not attempted.
3. **Given** a run whose work fits comfortably inside the ceiling, **When** it completes, **Then**
   the ceiling has no observable effect on the outcome.

---

### User Story 4 - Hopeless work is refused up front and failures are described honestly (Priority: P3)

A QA engineer is told immediately when the configured setup cannot complete the requested work,
instead of discovering it after the full budget has elapsed. When a run does fail, the explanation
reflects whether trying again could plausibly change the result.

**Why this priority**: Improves the failure path rather than the success path, and depends on the
pacing model established by the earlier stories. It also retires misleading guidance that currently
invites users to waste time.

**Independent Test**: Configure a setup in which the projected work clearly exceeds the available
budget, request enhancement, and confirm an immediate explained refusal with no generation attempted;
separately, confirm a repeatable failure is not described as intermittent.

**Acceptance Scenarios**:

1. **Given** a configuration under which the projected work cannot complete within the available
   budget, **When** the user requests enhancement, **Then** the request is refused within seconds,
   the explanation states in human-readable durations what was needed versus what was allowed, and no
   generation is attempted.
2. **Given** a failure that will recur identically on a retry, **When** the outcome is presented,
   **Then** it is not described as intermittent and no retry action is offered.
3. **Given** a failure that could plausibly succeed on a retry, **When** the outcome is presented,
   **Then** a retry action is offered.
4. **Given** any failure, **When** the outcome is presented, **Then** it contains no internal
   category literals, implementation constants, or raw millisecond values.

---

### User Story 5 - Dependency analysis benefits from the same pacing (Priority: P3)

A QA engineer finalises their scenario review, which runs dependency analysis. Rather than one long
request that overruns and contributes nothing, the AI-assisted pass works through several units,
contributes whatever relationships it can, and degrades to the deterministic relationships for any
unit it cannot complete.

**Why this priority**: Dependency analysis shares the splitting behaviour, so it inherits the fix
whether or not it is designed for. Treating it explicitly is what keeps unit sizing appropriate for
relationship inference instead of accidentally inheriting a size tuned for scenario enhancement.

**Independent Test**: Run dependency analysis against a real specification and confirm the AI pass is
divided into more than one unit, that a failing unit does not discard the others' relationships, and
that the deterministic relationships survive any outcome.

**Acceptance Scenarios**:

1. **Given** a specification of realistic size, **When** dependency analysis runs, **Then** its
   AI-assisted pass is divided into more than one unit of work.
2. **Given** a unit of dependency analysis work that fails, **When** the pass continues, **Then**
   relationships from successful units are retained and the pass is reported as partial.
3. **Given** any outcome of the AI-assisted pass — success, partial, failure, or budget exhaustion —
   **When** dependency analysis completes, **Then** the deterministically derived relationships are
   present and unmodified.
4. **Given** a unit of dependency analysis work, **When** its size is chosen, **Then** it covers
   enough operations for relationships between them to be inferable.

---

### Edge Cases

- **A specification with a single operation**: produces exactly one unit of work. Progress and
  cancellation must still behave sensibly rather than reverting to the hidden, uninterruptible
  single-request behaviour this feature exists to remove.
- **A single operation too large for one request**: it cannot be split further. It must be reported
  as an identified, named exclusion and must not stop the rest of the run.
- **Every unit fails**: the run must settle with the deterministic baseline intact and a single
  coherent explanation, not a per-unit error list the user must interpret.
- **Cancellation requested before any unit starts**: must settle promptly, retain the deterministic
  baseline, and be reported as cancelled rather than as a failure or as an empty success.
- **Cancellation requested during the final unit**: the run must not be reported as fully successful.
- **A reply containing more candidates than requested**: the excess must be handled by an explicit,
  deterministic rule rather than by whatever the validator happens to do.
- **A reply that echoes the request**: must be rejected as unusable — never partially salvaged into
  scenarios, since that is precisely how fabricated contract facts would enter the test model.
- **Duplicate suggestions across units**: a scenario already covered deterministically or by an
  earlier unit must not appear twice in the review workspace.
- **The run ceiling is reached partway through a unit**: the in-flight unit's result must not be
  discarded merely because the ceiling elapsed while it was resolving.
- **A dependency-analysis unit too small to infer relationships**: unit sizing must not shrink so far
  that operations which relate to one another are never in view together. Relationships spanning a
  unit boundary are an accepted limitation of batching and must be documented rather than presented
  as an absence of relationships.
- **A relationship inferred within one dependency-analysis unit and again in another**: must resolve
  deterministically to a single relationship, not a duplicate.

## Requirements *(mandatory)*

### Functional Requirements

#### Work-bounded batching

- **FR-001**: The system MUST size a unit of AI enhancement work by the number of operations it
  covers, using a small fixed bound, rather than by how much of the model's context window remains
  unused.
- **FR-002**: The system MUST continue to enforce a context-capacity check as an upper bound, so a
  unit that cannot fit is still split or reported, and MUST NOT allow the work-based bound to produce
  a request the model cannot accept.
- **FR-003**: The number of scenario suggestions the system requests MUST be expressed per unit of
  work such that the total requested across a run grows with the size of the specification.
- **FR-004**: The per-request output allowance MUST be sized to a single unit's expected reply, such
  that a unit completes well within the per-request time limit on the project's reference hardware
  profile.
- **FR-005**: Units MUST be derived deterministically: the same specification MUST always produce the
  same units, in the same order, with the same operations in each.
- **FR-006**: Every operation in the specification MUST appear in exactly one unit.
- **FR-007**: The system MUST retain the scenarios produced by successful units when other units fail,
  and MUST report such a run as partial.
- **FR-008**: A failing unit MUST NOT prevent subsequent units from being attempted.

#### Run-level budget and pacing

- **FR-009**: The system MUST enforce a wall-clock ceiling for an entire enhancement run, distinct
  from and additional to the existing per-request time limit.
- **FR-010**: On reaching the run ceiling, the system MUST stop starting new units, record the
  remaining units as not attempted, and settle the run as partial with everything already produced
  retained.
- **FR-011**: The run ceiling MUST be configurable, with a documented default, and MUST be validated
  at startup in line with existing configuration handling.
- **FR-012**: The system MUST report how many units are planned and how many have settled, throughout
  a run, including for runs consisting of a single unit.
- **FR-013**: The system MUST evaluate the existing pre-flight viability estimate before attempting
  generation, and MUST refuse the run without attempting generation when the projected work cannot
  complete within the available budget.
- **FR-014**: A pre-flight refusal MUST explain, in human-readable durations, what was projected and
  what the limit was, and MUST state that no time was spent attempting the work.
- **FR-015**: Cancellation MUST take effect at a unit boundary, and unit sizing MUST be such that the
  interval between boundaries is short enough for cancellation to feel responsive.

#### Response-shape reliability and honest failure

- **FR-016**: The prompt MUST demonstrate the expected reply with a concrete example for operations
  that carry a request body — the operations whose replies are longest and where truncation is the
  observed failure. For operations without a request body the example MUST be omitted: measurement
  showed it does not improve validity there and measurably lengthens generation, and under a run
  ceiling (FR-009) time spent is coverage lost.
- **FR-017**: A reply that restates the request rather than answering it MUST be rejected as unusable
  and MUST NOT be partially salvaged into scenarios.
- **FR-018**: If the prompt's structure or the expected reply shape changes, the AI response contract
  version MUST be incremented rather than changed silently.
- **FR-019**: The system MUST distinguish failures that could plausibly succeed on a retry from those
  that will recur identically, and MUST offer a retry action only for the former.
- **FR-020**: A failure explanation MUST NOT describe a deterministically reproducible failure as
  intermittent.
- **FR-021**: User-facing failure explanations MUST NOT contain internal error-category literals,
  implementation constant names, or raw millisecond values.

#### Preservation of existing guarantees

- **FR-022**: Deterministically generated scenarios MUST NOT be removed, modified, or blocked by any
  outcome of AI enhancement, including total failure, partial failure, cancellation, and pre-flight
  refusal.
- **FR-023**: Every AI-derived scenario MUST remain distinguishable from deterministic scenarios by
  its provenance, and MUST remain subject to the existing review gate.
- **FR-024**: AI-derived scenarios MUST continue to be validated against the full specification, so
  that a suggestion referencing anything not in the real contract is rejected.
- **FR-025**: All AI interaction MUST continue to flow through the existing provider abstraction, and
  no inference input may leave the local machine.
- **FR-026**: Deduplication across units MUST be deterministic and stable, so that a scenario retained
  for an earlier unit is never revoked by a later one.
#### Application to dependency analysis

- **FR-027**: Work-bounded unit sizing MUST govern both AI-assisted passes — scenario enhancement and
  dependency analysis — rather than only the former.
- **FR-028**: The unit size MUST be selectable per caller rather than shared, because the two passes
  reason differently: scenario enhancement considers one operation's contract at a time, while
  dependency analysis infers relationships *between* operations and needs several in view at once.
- **FR-029**: The dependency-analysis unit size MUST be large enough that operations which relate to
  one another can appear in the same unit, and MUST be settled by measurement against a specification
  with known relationships rather than assumed.
- **FR-030**: A failing unit of dependency-analysis work MUST NOT discard relationships already
  contributed by successful units, and such a pass MUST be reported as partial.
- **FR-031**: The deterministically derived relationships MUST be present and unmodified after every
  outcome of the AI-assisted pass, including total failure, budget exhaustion, and refusal.
- **FR-032**: Relationships inferred in more than one unit MUST resolve deterministically to a single
  relationship.
- **FR-033**: The AI-assisted pass of dependency analysis MUST be governed by a run ceiling in the
  same way as enhancement, and the existing analysis performance budget MUST continue to govern only
  the deterministic matching and workflow-assembly work.
- **FR-034**: Where batching prevents a relationship spanning a unit boundary from being inferred,
  that limitation MUST be documented for the user rather than presented as a confirmed absence of
  relationships, consistent with No Silent Assumptions (XIV) and Conservative Dependency Inference
  (XV).

### Key Entities

- **Unit of work**: A small, fixed-size group of operations forming one AI request. Deterministically
  derived from the specification; the atom of progress reporting, cancellation, failure isolation, and
  partial retention. Its size is chosen per calling pass — smaller for scenario enhancement, larger
  for dependency analysis, which must see several operations together to relate them.
- **Run plan**: The ordered set of units for one enhancement run, plus the count of units planned.
  Establishes what "how much is left" means to the user.
- **Run budget**: The wall-clock ceiling for a whole run, distinct from the per-request time limit.
  Governs when the system stops starting new units.
- **Unit outcome**: Whether a unit succeeded, failed (with a category), or was not attempted (ceiling
  reached or run cancelled). Aggregates to the run outcome.
- **Viability estimate**: A pre-flight projection of whether requested work can complete within the
  available budget, used to refuse hopeless work before generation begins.
- **Failure explanation**: The user-facing account of a non-success outcome, including whether a retry
  could change the result.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running AI enhancement on a small real specification (roughly six operations) yields at
  least one usable AI-suggested scenario, where today it yields none.
- **SC-002**: The number of AI-suggested scenarios offered grows with specification size: a
  specification roughly thirty times larger yields proportionately more suggestions, not the same
  small fixed number.
- **SC-003**: The first AI-suggested scenario becomes visible and reviewable within roughly one unit
  of work's duration of the run starting, rather than only when the whole run finishes.
- **SC-004**: A cancellation request takes effect within approximately one unit of work's duration —
  targeting well under 30 seconds — measured from the request, compared with 56 seconds measured today.
- **SC-005**: No enhancement outcome — success, partial, total failure, cancellation, or refusal —
  removes, alters, or blocks any deterministically generated scenario. Verified for every outcome.
- **SC-006**: A run whose work exceeds the run ceiling settles as partial within that ceiling, retains
  everything produced, and never runs unbounded.
- **SC-007**: Work that cannot complete within the available budget is refused within seconds of the
  request, with no generation attempted.
- **SC-008**: Repeating a run against an unchanged specification produces the same units, in the same
  order, covering the same operations, every time.
- **SC-009**: No user-facing failure message contains an internal category literal, an implementation
  constant name, or a raw millisecond value.
- **SC-010**: A retry action is offered only where retrying could plausibly produce a different
  outcome.
- **SC-011**: The AI-assisted pass of dependency analysis is divided into more than one unit for a
  specification of realistic size, where today it is always exactly one.
- **SC-012**: Dependency analysis retains its deterministically derived relationships after every
  outcome of its AI-assisted pass, verified for success, partial, total failure, budget exhaustion,
  and refusal.
- **SC-013**: Against a reference specification with known relationships, the chosen
  dependency-analysis unit size detects no fewer relationships than today's single-unit sizing would
  if that request succeeded — establishing that batching costs coverage no more than it must.

## Assumptions

- **Unit size default**: For scenario enhancement, a unit covers **one operation by default**,
  configurable per caller. Planning measured one operation as the value that works on the reference
  hardware profile — two and three operations both truncate mid-document — but the figure belongs in
  configuration rather than in a requirement, so a faster machine or a stronger model can raise it
  without amending this specification.
- **Dependency-analysis unit size**: Assumed to be materially larger than the enhancement unit, since
  relationship inference needs several operations in view at once. The figure is to be settled during
  planning by measuring relationship detection against a specification with known relationships, and
  is expected to be a trade-off between detection coverage and request duration (XXX).
- **Run ceiling default**: A default on the order of a few minutes, chosen to match how long a QA
  engineer will reasonably wait, and configurable for users with faster hardware or larger
  specifications. The precise default is to be settled during planning.
- **Suggestions per unit**: Requesting one to two candidates per unit is assumed sufficient; quality
  per unit is preferred over volume, consistent with Quality Over Quantity (XII).
- **Reference hardware**: Sizing decisions are calibrated against the CPU profile already used by
  `013-ai-enhancement-viability`, not against accelerated inference.
- **Model unchanged**: The default model stays as it is. This feature makes the existing model
  workable by reshaping the work sent to it, and does not depend on a model upgrade.
- **Total run time will increase**: Work-bounded batching means a large specification takes longer in
  total than one oversized request would have. This is the explicit trade-off (XXX) — the current
  single request is faster only because it reliably produces nothing — and is what the run ceiling and
  incremental delivery of results exist to make acceptable.
- **Existing machinery is reused**: Incremental streaming into the review workspace, per-batch progress
  reporting, boundary-checked cancellation, and the partial outcome status already exist. This feature
  is expected to make them effective rather than to rebuild them.
- **Uninterruptible inference persists**: A request already in flight still cannot be preempted; this
  feature reduces the consequences by shortening requests, and does not attempt to fix the underlying
  cause.
- **Bug fix already landed**: The unhandled-rejection crash and the dependency-analysis budget guard
  that triggered it have been fixed separately and are not part of this feature.

## Out of Scope

- **Selecting which operations to enhance.** Letting a user enhance a chosen subset rather than the
  whole specification is the intended fast follow-up and needs its own user-experience treatment.
- **Changing the default model.** A larger model would improve instruction-following but is slower on
  CPU; that is an evidence-driven decision under Model Selection Is an Engineering Decision (VII) and
  belongs in its own specification.
- **Moving inference off the main thread.** This is why per-request time limits report lateness rather
  than preventing it, and why cancellation cannot interrupt work already in flight. It is a separate
  architectural change.
- **Constrained or grammar-based decoding.** A stronger guarantee of reply shape than a demonstrated
  example, dependent on inference-runtime capabilities.
- **The wider defects found in the same QA session** — negative-test assertions borrowing an unrelated
  documented status code, non-reproducible export ordering, the review screen not refreshing after a
  single-scenario decision, and the discarded specification server URL. Each is independent of batching
  and needs its own specification.
