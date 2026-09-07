# Phase 0 Research: AI Batching Policy and Run Pacing

**Feature**: `014-ai-batching-policy` | **Date**: 2026-09-06

All figures below were measured on this repository's shipped default configuration
(`onnx-community/Qwen2.5-0.5B-Instruct`, fp32, CPU, `AI_INFERENCE_TIMEOUT_MS=60000`) against the
6-operation springdoc-style specification used in the QA session that produced this feature.

> **Measurement hygiene**: an initial pass produced non-monotonic results — a 1-operation request
> at 128 output tokens measured *slower* (48.2s) than a 3-operation request at 192 tokens (34.8s).
> The cause was a second backend process on the machine running inference concurrently (7.5 GB
> resident, ~2.5 cores sustained). Every figure below was re-measured with that process confirmed
> idle (0 CPU seconds over a 6-second sample). **Any future re-measurement must verify machine
> quiescence first**; contended figures are worse than no figures, because they look authoritative.

---

## Decision 1: One operation per unit of work (scenario enhancement)

**Decision**: A unit of scenario-enhancement work covers **one operation by default**, configurable
per caller. The specification requires a small work-bounded unit; the value of 1 lives here and in the
configuration default, so faster hardware or a stronger model can raise it without a spec amendment.

**Rationale**: One operation per unit is the difference between reliably usable output and no output
at all — it is not a tuning preference. Measured, with a 192-token allowance and no worked example:

| Unit size | Result |
| --- | --- |
| 1 operation | 5 of 6 operations produced a valid candidate list (14.6–28.2s each) |
| 2 operations | Truncated mid-document even at a 256-token allowance (36.0s) |
| 3 operations | Truncated mid-document at a 192-token allowance (33.0s) |
| 6 operations (today) | Echoed the request back, truncated, `INVALID_RESPONSE` (~57s) |

The failure mode changes qualitatively with unit size. At six operations the model **restates the
request** instead of answering it; at two or three it attempts an answer but cannot finish it inside
any allowance that also fits the time budget; at one it answers correctly. The prompt for a single
operation is 837–1,209 characters, small enough that the reply is a short, closed document.

**Alternatives considered**:

- *Two to three operations per unit* (the range assumed in the specification's Assumptions section):
  rejected on measurement. Both truncate. The specification's assumed range was written before these
  figures existed and is superseded by this decision.
- *Keep context-capacity sizing and only shrink the output allowance*: rejected. A smaller allowance
  applied to a large batch truncates sooner, it does not make the reply shorter.

---

## Decision 2: 256-token output allowance for scenario enhancement

**Decision**: `AI_SCENARIO_MAX_OUTPUT_TOKENS` becomes **256** (from 384).

**Rationale**: 192 tokens covers five of the six operations but truncates on `PUT /v1/jobs`, the
operation with the largest request body (four fields). At 256 that operation succeeds, giving **6 of
6**:

| Operation | 192 tokens | 256 tokens |
| --- | --- | --- |
| `PUT /v1/jobs` (largest body) | truncated (28.2s) | valid (30.4s) |
| Other five operations | valid (13.0–20.6s) | — |

A larger allowance costs nothing on operations that do not need it: the same easy operation measured
14.6s at a 192-token allowance and 14.3s at 320. The allowance is a cap, not a price — generation
stops when the document closes. 256 therefore buys coverage of body-heavy operations without
penalising the common case.

**Alternatives considered**:

- *192 tokens*: rejected — leaves body-heavy operations systematically failing, which would silently
  bias AI coverage toward simple operations.
- *320 tokens*: measured valid (32.8s) but buys nothing over 256 on this corpus while raising the
  worst-case duration closer to the per-request timeout.

---

## Decision 3: Worked example only for operations carrying a request body

**Decision**: Include the worked input→output example **only for operations that have a request
body**. Omit it for operations without one. FR-016 amended accordingly.

**Rationale**: FR-016 assumed the echo behaviour was caused by the prompt describing the reply rather
than demonstrating it. Decision 1 shows that is not the cause — one operation per unit produces a
correctly shaped reply with no example at all. But the example is not therefore useless: the paired
comparisons show it helps exactly where truncation threatens, and costs time where it does not.

| Operation | No example | With example | Effect |
| --- | --- | --- | --- |
| `GET /v1/jobs` — no body, short reply | **17.1s / 17.3s** (2 runs, valid) | 23.9s (valid) | example costs ~6.6s |
| `PUT /v1/jobs` — 4-field body, longest reply | 30.4s (valid) | **21.2s** (valid) | example saves ~9.1s |

`PUT /v1/jobs` is the only operation in the corpus that was ever at risk: it truncated at a 192-token
allowance and is what forced Decision 2 to 256. It is also the one the example helped. The mechanism
is plausible — an example steers the model toward a compact reply, and compactness is precisely what
prevents truncation.

The conditional rule matters because of Decision 5's run ceiling: time per operation determines
coverage directly. At ~21s per operation a 5-minute ceiling covers roughly 14 operations, so spending
~6.6s of example overhead on body-less operations that gain nothing costs roughly three operations of
coverage on a mixed specification. Presence of a request body is a reliable, cheap proxy for "this
reply will be long".

**Evidence strength**: the decisive cells are n=1 each and this machine's timing is noisy.
Implementation must validate the rule across a corpus with more body-heavy operations before locking
it in. **If the conditional proves fiddly in the prompt builder, always-on is the correct fallback,
not always-off** — truncation loses the whole unit, whereas the overhead only costs time.

**Alternatives considered**:

- *No example at all*: this research phase's original recommendation, based only on the easy-operation
  comparison. Rejected on the paired hard-operation result, which is the case that actually fails.
- *Always include it*: rejected as the default because it spends measurable time on body-less
  operations for no measured benefit, and under a ceiling that time is lost coverage. Retained as the
  fallback if the conditional is impractical.
- *Grammar-constrained decoding*: already out of scope; not supported by the current runtime.

---

## Decision 4: Contract version increment

**Decision**: Increment `AI_SCENARIO_RESPONSE_VERSION` from 2 to **3**.

**Rationale**: The bytes the model sees change materially — the operation set per request goes from
"all operations" to "one operation", and the candidate ceiling per request changes with it. Version AI
Contracts (XXIII) requires this be visible rather than silent, exactly as `013-ai-enhancement-viability`
incremented 1→2 when it replaced the serialized model with a contract projection.

Note this holds even though Decision 3 declines the example: the *structure* of the request is
unchanged, but its *scope* is not, and scope is what determines the reply.

---

## Decision 5: Run ceiling default of 5 minutes

**Decision**: Introduce `AI_ENHANCEMENT_RUN_BUDGET_MS`, defaulting to **300000** (5 minutes).

**Rationale**: At one operation per unit, measured mean ≈ 21s per unit (range 13.0–32.8s), total run
time is now linear in specification size:

| Specification size | Projected full-run duration |
| --- | --- |
| 6 operations | ~2 minutes |
| 50 operations | ~17 minutes |
| 200 operations | ~70 minutes |

A ceiling is therefore not optional — it is what stops Decision 1 from replacing "fails in one
minute" with "runs for an hour". Five minutes covers roughly 14 operations, is within what a user
will plausibly wait while watching scenarios stream in, and settles as `partial` with everything
generated retained.

**This makes operation selection the critical follow-up, not a nicety.** At ~21s per operation,
whole-specification enhancement is impractical beyond roughly 15–30 operations at *any* ceiling. The
ceiling converts an impossible run into a useful partial one; selecting operations is what makes the
budget land on operations the user actually cares about. This is recorded as a limitation of this
feature in `plan.md`'s Complexity Tracking.

**Alternatives considered**:

- *No ceiling, rely on cancellation*: rejected. Requires the user to babysit the run, and Fail Safely
  (XIX) argues for a bounded default over an unbounded one.
- *A ceiling derived from operation count*: rejected as surprising — the user cannot predict it, and
  it would make the same specification behave differently on different hardware.

---

## Decision 6: Dependency analysis needs a prompt projection before batching helps

**Decision**: Work-bounded batching alone does **not** make the dependency-analysis AI pass viable.
Its prompt must first be reduced to a contract projection, as `013-ai-enhancement-viability` did for
the enhancement prompt. Both changes are in scope for this feature (FR-027).

**Rationale**: `buildAIDependencyPrompt` serializes the **entire raw `ApiModel`** into the request —
every schema, every response, every nested property. It never received the projection treatment.
Measured prompt sizes and outcomes:

| Unit size | Prompt | Outcome (60s provider limit) |
| --- | --- | --- |
| 2 operations | 9,410 chars | `TIMEOUT` |
| 4 operations | 13,181 chars | `TIMEOUT` |
| 6 operations | 17,151 chars | `TIMEOUT` |

For comparison, a **one-operation enhancement** prompt is 837–1,209 characters. Dependency analysis
spends roughly **ten times more prompt per operation**, and times out at every unit size tested —
including the smallest one that could still express a relationship. Reducing the unit size cannot fix
a cost that is per-operation.

Note also that production uses `AI_DEPENDENCY_TIMEOUT_MS = 8000`, far below the 60s these trials were
given, so in the shipped configuration this pass fails even more decisively.

**Ordering consequence**: the projection must land before or with the batching change. Shipping
batching alone for dependency analysis would produce more requests that each still time out — strictly
worse than today.

**Alternatives considered**:

- *Batching only, projection deferred*: rejected on the measurement above.
- *Drop the AI pass from dependency analysis*: not chosen here, but noted as a legitimate option if
  projection plus batching still fails to beat deterministic matching. Conservative Dependency
  Inference (XV) means a pass contributing nothing is no loss.

---

## Decision 7: Per-caller unit size, resolved by prompt cost

**Decision**: Unit size is a **per-caller parameter** of the splitting function, not a global
constant. Enhancement passes 1. Dependency analysis passes a value set after its prompt projection
lands, and must be validated against a specification with known relationships (SC-013).

**Rationale**: The two passes have opposite pressures. Enhancement reasons about one operation's
contract, so the smallest unit is the best unit. Dependency analysis infers relationships *between*
operations and cannot find a relationship whose two ends are in different units — for it, smaller
units directly cost coverage. A single shared constant would have to be wrong for one of them.

The dependency-analysis figure is deliberately **not** fixed here: with the current prompt it cannot
be measured meaningfully, since every size times out. Decision 6's projection must land first, and the
figure is then settled by measuring detected relationships, not duration.

**Alternatives considered**:

- *One shared constant*: rejected — guarantees the wrong size for at least one caller.
- *Fix the dependency figure now*: rejected — it would be a guess presented as a measurement, which is
  what this research phase exists to prevent.

---

## Decision 8: Wire the existing viability estimate at the unit level

**Decision**: Call `estimateViability` before generation, evaluated against a **single unit's**
projected cost, and refuse the run when even one unit cannot fit the per-request budget.

**Rationale**: The estimator and its `not-viable` explanation are already implemented and already
tested, but are called from nowhere in `backend/src`. With uniform, small units the projection becomes
meaningful in a way it never was for one variable-sized giant request: every unit costs approximately
the same, so one estimate characterises the whole run.

The configured seed rates are approximately correct on this hardware and need no change:
`AI_DECODE_MS_PER_TOKEN=130` against a measured ~140 ms/token.

**Alternatives considered**:

- *Estimate the whole run and refuse if it exceeds the run ceiling*: rejected — that is what `partial`
  is for. A long run that delivers useful partial results must not be refused outright.

---

## Specification amendments — resolved

Two items in `spec.md` were contradicted by measurement. Both were raised for decision rather than
changed unilaterally, and both have now been settled and applied:

1. **FR-016 (worked example)** — **Resolved: conditional.** The example is included only for
   operations carrying a request body (Decision 3). The original proposal to drop it entirely was
   withdrawn: it rested on the easy-operation comparison alone and ignored the paired result on the
   one operation that actually truncates.
2. **Assumptions: "unit size on the order of one to three operations"** — **Resolved: one by default,
   configurable per caller** (Decision 1). Two and three both truncate on the reference profile, but
   the figure belongs in configuration rather than in a requirement, so it can be raised on faster
   hardware without amending the specification.

---

## Decision 9: The prompt must state the category vocabulary and request shape (found during implementation)

**Decision**: Enumerate the supported scenario categories in every prompt, and state the request and
assertion shapes in the `output` contract for every prompt — not only those carrying the worked
example.

**Rationale**: Phase 0 measured *reply validity* — whether the model returned a parseable document
containing a `candidates` array. It did not measure *candidate acceptance*. Implementing US1 and
running against the real model exposed the difference.

First real-model run after work-bounded batching landed, against the 3-operation Pet Store fixture:

| Measure | Result |
| --- | --- |
| Units | 3, one per operation |
| Unit outcomes | 3 of 3 **succeeded** — no echo, no truncation |
| Candidates produced | 5 |
| Candidates accepted | **0** |
| Rejection reason | `unsupported-category`, all five |

The model invented category names — `"Positive Response"`, `"Negative Response"`,
`"Invalid Request Type"`, `"invalid-request"` — because nothing in the prompt told it the vocabulary
is closed. A validator can only reject an invented value; the prompt is the only place that can stop
it being invented (constitution I). The same run also showed flat, invented request shapes
(`{"limit":5,"page":1}`) on operations with no request body, where no worked example is attached to
demonstrate the real one.

This also revealed a defect in Decision 3's example itself: it declared `category: "not-found"`,
which is **not** a supported category, so the example was teaching an invalid value. Corrected to
`invalid-format`.

After adding `categories`, `output.requestShape` and `output.assertionShape`, the same fixture:

| Measure | Before | After |
| --- | --- | --- |
| Shape rejections | 5 | **0** |
| AI scenarios accepted | 0 | **1** |
| Deterministic scenarios preserved | yes | yes |

The one remaining rejection is semantic, not structural: a candidate placed body fields into
`pathParameters` and was refused by `validateAICandidateSemantics`. That is the validator working as
designed — refusing to fabricate contract facts — not a regression.

**Consequence for Decision 3**: the evidence for the *conditional* example rule is now weaker than it
looked. The example demonstrates request shape as well as reply shape, and body-less operations were
measured getting request shape wrong without it. Stating `requestShape` for every prompt addresses
that without paying the example's cost everywhere, but T058 should re-examine whether always-on is
now the better rule.

**Alternatives considered**:

- *Relax the validator to accept invented categories*: rejected outright. Category is contract
  vocabulary; accepting anything the model emits is precisely how unexplained scenarios enter the
  test model (constitution I, III, IV).
- *Map invented categories onto supported ones*: rejected as guessing at malformed content, which
  constitution IV forbids for exactly this reason.

## Unknowns remaining

None blocking Phase 1. One figure is deliberately deferred with a defined resolution path: the
dependency-analysis unit size (Decision 7), which cannot be measured until Decision 6's prompt
projection exists, and whose acceptance test is already written as SC-013.
