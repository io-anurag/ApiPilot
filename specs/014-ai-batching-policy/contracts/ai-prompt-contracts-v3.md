# Contract: AI Prompt Scope and Response Versions

**Feature**: `014-ai-batching-policy` | **Status**: Draft

Two AI prompt contracts change scope. Under Version AI Contracts (XXIII) both response versions
increment rather than changing silently.

---

## Scenario enhancement prompt — version 2 → 3

### What changes

The prompt's **structure** is unchanged. Its **scope** changes, and scope determines the reply:

| Aspect | Version 2 | Version 3 |
| --- | --- | --- |
| Operations per request | All operations in the batch (context-bounded, typically all of them) | Exactly 1 |
| `existingCoverage` | Baseline for the whole batch | Baseline for that one operation |
| Candidate ceiling | "at most 3" for the whole batch | Per single operation |
| Output allowance | 384 tokens | 256 tokens |
| Worked example | none | present **only for operations with a request body** |

### Conditional worked example

The example is included when — and only when — the operation carries a request body. Those are the
operations whose replies are longest and where truncation is the observed failure.

| Operation | No example | With example | Effect |
| --- | --- | --- | --- |
| `GET /v1/jobs` — no body | **17.1s / 17.3s** (valid) | 23.9s (valid) | costs ~6.6s, no benefit |
| `PUT /v1/jobs` — 4-field body | 30.4s (valid) | **21.2s** (valid) | saves ~9.1s |

Reducing scope to one operation is what removes the echo behaviour; the example is not needed for
that. What the example does is steer the model toward a *compact* reply, which is what prevents
truncation on long-reply operations. Applying it unconditionally would spend ~6.6s per body-less
operation for no measured benefit — and under the run budget that time is lost coverage
(research.md Decisions 3 and 5).

**Implementation constraints**:

- The rule is a pure function of the operation: request body present → include the example.
- Prompt size therefore varies more between units. This is acceptable — it already varies (837–1,754
  characters observed) — but the viability estimate must be computed against the **larger**
  (with-example) shape so it never under-projects.
- The decisive measurements are n=1 per cell. Validate across a corpus with more body-heavy operations
  before locking the rule in. **If the conditional proves impractical, always-on is the correct
  fallback, not always-off**: truncation loses the whole unit, overhead only costs time.

### Acceptance

Measured against the 6-operation reference specification, one operation per request, 256-token
allowance: **6 of 6 operations produce a validly shaped candidate list**, 14.6–30.4s each. Version 3
must not regress below this.

---

## Dependency analysis prompt — version 1 → 2

### What changes

`buildAIDependencyPrompt` currently serializes the **entire raw `ApiModel`** — every schema, response,
and nested property. Measured: 9,410 characters for two operations, versus 837–1,209 characters for a
one-operation enhancement prompt. It times out at every unit size tested, including two operations
(research.md Decision 6).

Version 2 replaces the serialized model with a projection carrying only what a producer/consumer
relationship can be inferred from:

**Retained**: operation path, method, operationId; parameter names, locations, types; request-body
field names and types; response field names and types.

**Dropped from the model's view**: descriptions, examples, tags, security blocks, nested schema
detail below the first level, and the deterministic relationship set.

### Constraint

What is dropped is dropped from the model's *view* only. Candidates remain validated against the full
`ApiModel`, so a suggestion referencing anything outside the real contract is rejected on exactly the
evidence it is today (I, IV).

### Ordering

The projection must land **before or with** the batching change for this caller. Batching alone would
produce more requests that each still time out — strictly worse than today (research.md Decision 6).

### Acceptance

The dependency-analysis unit size is set only after this projection exists, by measuring **detected
relationships** against a specification with known relationships (SC-013) — not by measuring duration.
A unit size that completes quickly but detects fewer relationships is a regression, not a success.

---

## Shared expectations

- A reply restating the request rather than answering it is rejected as unusable and never partially
  salvaged into scenarios or relationships (FR-017).
- Version constants are asserted in unit tests so an incremented contract cannot ship without its
  test being updated.
- Both prompts remain plain data sent through the existing provider abstraction; no inference input
  leaves the local machine (FR-025, V).
