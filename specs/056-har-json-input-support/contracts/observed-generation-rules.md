# Behavioural Contract: Observed and Declared Generation Rules

How the existing deterministic pipeline treats operations that did not come from an OpenAPI document. Extends
[specs/003-deterministic-test-designer](../../003-deterministic-test-designer/) without changing it for OpenAPI input
(FR-034). Rationale: [research.md](../research.md) R19 to R21.

## Rule-set dispatch

`generateTestModel` selects rules per operation from `operation.provenance?.origin`:

| `provenance.origin` | Rules | Assertions |
| --- | --- | --- |
| absent or `documented` | existing `RULES`, unchanged | existing `assertions.ts`, unchanged |
| `declared` (definition) | existing `RULES` + `declaredExampleScenarios` | existing `assertions.ts` over declared responses |
| `observed` (HAR) | `observedExampleScenarios` only | status code only, `basis: "observed"` |

The designer reads only the normalized `ApiModel`; it imports no parser (FR-030). `deduplicate` runs over the combined list
as today, preserving provenance and `duplicateOfRules`.

## `declaredExampleScenarios` (definition input)

Fires only for an operation that declares at least one request example for its primary body and has no body schema the
existing positive rule could generate from. Emits one `positive` scenario using the first declared example (declared order),
`evidence: { origin: "declared", derivation: "declared-example", summary }`. Assertions come from
`selectPositiveAssertions` (declared statuses and schemas), `basis: "declared"`. Negative and boundary scenarios come only
from the existing rules, and therefore only where a declared schema supports them.

## `observedExampleScenarios` (HAR input)

Inputs: `operation.observed` (examples, status counts, body evidence). No other source.

1. **Positive, one per observed 2xx status.** For each distinct 2xx status in `statusCounts` (ascending), take the example
   with that `responseStatus` having the highest `observations` (ties: lowest `firstEntryIndex`), considering only
   examples whose `contentType` equals the operation's primary request content type (JSON if any, else the first declared),
   so the exporter emits a body that matches the example. The scenario request is that example (a JSON body as parsed, a
   form-encoded or multipart text-field body as its flat object, FR-056), unless it has `bodyUnavailable` (a request that
   sent a body we could not read, including a multipart file part, cannot be reproduced; the next candidate for that status
   is used, and if none remains the operation gets a note below). The assertion list is exactly `[ { type: "status-code", expectedStatusCode: <status>, basis: "observed" } ]`.
   `category: "positive"`. `evidence: { origin: "observed", observationCount: <example observations>, derivation:
   "observed-example", summary: "Observed N time(s) in the capture, returned <status>." }`. Rule name
   `observed-example-positive`.
2. **Missing-field, evidence-gated.** For each request-body field path with `presentIn === observations` and
   `observations >= OBSERVED_EVIDENCE_MIN_OBSERVATIONS` (3), emit one `missing-field` scenario: the chosen positive
   example's request with that field removed. Rule name `observed-field-omitted`.
   This applies to JSON and to form-style bodies alike (a form field is presence evidence; removing one is a request the
   observed data supports).
3. **Invalid-type, evidence-gated, JSON bodies only.** For each JSON request-body field path with exactly one key in `types`
   and `observations >= 3` and `presentIn >= 3`, emit one `invalid-type` scenario using the existing wrong-type value helper.
   Rule name `observed-field-type-violated`. Form-style fields are never type-mutated: every form value is a string by
   encoding, so a "wrong type" would be an artifact of the encoding, not an observed constraint.
4. **Negative assertion rule.** Scenarios 2 and 3 carry `evidence.derivation: "inference-derived"` and `evidence.origin:
   "inferred"`, with `observationCount` equal to the field's `presentIn` and a summary stating the observed fact (for
   example "Field `email` was present in 5 of 5 observed request bodies."). Their assertion list is empty with a gap
   description ("no failure response was observed for this request; the expected outcome is not asserted") **unless** an
   observed example with a non-2xx status has a request deeply equal to the mutated request, in which case the assertion
   is that example's status with `basis: "observed"`.
5. **Never generated** for observed operations: boundary scenarios (numeric, string, array), enum scenarios, format
   scenarios, null or empty scenarios, response header, body or schema assertions, any assertion on a status that was not
   observed.

### Skipped operations (FR-040)

When no scenario results from an observed operation, a `GenerationNote` records the first applicable reason, in this order:

1. `"No successful (2xx) response was observed, so no positive scenario can be justified."`
2. `"Every observed request with a body had a multipart file part, which cannot be reproduced."`
3. `"The only observed request example had an unavailable body (<reason>)."`
4. `"No observed 2xx example uses the operation's primary request content type (<content type>)."`

A single observed 2xx example is enough for the positive scenario, so there is no "too few observations" reason for it; the
evidence threshold applies only to the negative scenarios, which are simply not generated below it. The operation stays
selectable in review. Notes are listed per operation in the deterministic generation stage.

## Scenario labelling in the UI

A scenario's `evidence` is shown in scenario detail as text: origin (`Observed`, `Inferred`, `Declared`), observation count,
and the summary. A negative derived from observation shows the label "Inference-derived". Assertion `basis` shows as
"Observed" or "Declared" next to the expected status; documented assertions show no extra label (unchanged).

## Dependency evidence

### Value reuse in a capture (HAR)

After grouping, over imported entries in chronological order (see [har-import-rules.md](har-import-rules.md), *Ordering*):

1. From each response body that is available JSON, extract scalar leaves: dotted field path (`[]` for arrays), at most 500
   per body.
2. A value is **distinctive** when: string of at least 8 characters, or integer of at least 4 digits; not boolean or null;
   not in the stoplist (`application/json`, `true`, `false`, `null`, `undefined`, ISO 4217 codes, `en-US`-style locale
   tags); produced by exactly one `(operation, field)` pair in the capture; not equal to the value of 3 or more different
   fields.
3. For each distinctive value, search **later** entries of **other** operations: normalized path segments (mapped to the
   path parameter name when inferred), query values, header values, JSON request body leaves.
4. Each `(producer field, consumer field)` pair with at least one match produces a `DependencyHint`: `origin: "observed"`,
   `matchCount` = distinct consuming entries, `orderObserved: true`, `sampleValue` truncated to 32 characters, withheld
   (`valueWithheld: true`) when either field name is credential-like or the value matches a credential or email pattern.
   Credential-position matches (for example a login token reused in `Authorization`) are kept with the value withheld.

Pre-redaction values exist only inside this function, which returns hints and nothing else.

### Confidence

| Source of relationship | Confidence |
| --- | --- |
| Observed hint, `matchCount === 1` | `POSSIBLE` |
| Observed hint, `matchCount >= 2` | `LIKELY` |
| Observed hint alone | never `CONFIRMED` (FR-038) |
| Declared hint, both fields exist in declared schemas | `CONFIRMED` |
| Declared hint, a side has no declared schema | `LIKELY`, with the reason in `explanation` |
| Hint plus the existing deterministic analysis finding the same pair | the higher confidence of the two; `source` stays `deterministic`, `inputEvidence` attached |

Hints flow through the existing `mergeRelationships` disambiguation, cycle detection and `assembleWorkflows`; only
`CONFIRMED` and `LIKELY` relationships can become workflows, as today. `POSSIBLE` requires manual confirmation, as today.

## AI enhancement

Unchanged provider, queue, batching and validation. For non-OpenAPI models the prompt gains one sentence: *"These operations
come from captured or declared traffic; listed statuses are observed or declared, not documented guarantees."* The OpenAPI
prompt is byte-identical. Candidates referencing an operation, field or status absent from the model are rejected by the
existing validator; for an observed operation the model contains only observed statuses and fields.

## Postman and execution

The exporter changes only as set out in [postman-artifact-amendment.md](postman-artifact-amendment.md): form-encoded and
multipart text-field bodies are emitted (FR-056), and the redaction placeholder `[redacted:<kind>]` is recognized in headers,
body fields, query and path values and replaced by the existing secret variable references, with generation refused if a
placeholder would remain. Credential values are not in the model, so they cannot reach an artifact. Output for every input
without form bodies or placeholders is unchanged. The origin recorded in a capture or a definition's `baseUrl`
is never used as an execution target; execution requires the user's explicit environment selection and the existing
confirmation controls (FR-052).
