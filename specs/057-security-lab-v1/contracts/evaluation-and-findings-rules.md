# Contract: Evaluation, Confidence, Severity and Findings

**Status**: behavioural. **Spec**: FR-053 to FR-059, SC-011. Implemented in `backend/src/securityLab/evaluation/` and `findings/`.
All functions are pure and AI-free (Principle II).

## Condition evaluation

Each condition evaluates against one scenario's evidence list to `satisfied`, `violated` or `indeterminate`.

| Condition | satisfied | violated | indeterminate |
|---|---|---|---|
| `status.not-success` | no 2xx in any decisive response | a 2xx for a decisive request | transport error, truncated before status, 3xx blocked redirect |
| `status.in-set` / `equals` / `not-equals` | as named | as named | no response |
| `header.present` / `absent` | as named | as named | no response |
| `header.value-not-contains` | token absent | token present | header missing and the rule needs it |
| `body.field-absent` / `present` | as named | as named | body not JSON, truncated before the path, or empty |
| `body.not-match-leak-pattern` | pattern absent | pattern present | body binary or truncated before the end of the excerpt window |
| `repeat.limit-engaged` | a limiting status (429, or a documented one) within N requests | none within N, all requests answered | fewer than N answered, or a transport error |
| `persisted.field-unchanged` | follow-up read shows the original value | follow-up shows a different value | no follow-up read configured or read failed |

"Decisive request" is the last request of a scenario for single-request scenarios and every request for `request.repeat`.

## Scenario outcome

1. No request sent because of a block, unmet prerequisite or destination refusal → `blocked`.
2. Not reached because of budget or cancellation → `not_run`.
3. Transport failure for the decisive request (timeout, connect, TLS, abort, read-limit) → `errored`.
4. Else any condition `violated` → `failed`.
5. Else any condition `indeterminate` → `inconclusive`.
6. Else → `passed`.

Only `failed` creates or extends a finding, and a scenario version has at most one finding (FR-054): the first `failed` result
creates it, each later `failed` result of the same version appends an occurrence (rules below). `blocked`, `not_run`, `errored`
and `inconclusive` never create or extend one and never count as passed.

## Confidence (never assigned by a model)

| Level | When | Basis text recorded |
|---|---|---|
| high | `expected.basis = documented` and a single unambiguous decisive response violates it | names the documented status set and the observed status |
| medium | `expected.basis = product-rule` and a clear decisive response violates it | names the product rule id |
| low | violation visible only across repeated requests, or evidence truncated near the decisive part, or a persisted-state check without a stable read | states which |

## Severity

Starts at the scenario version's `suggestedSeverity`. The engine never raises it. A user may change `current` with a note; `suggested`
is immutable and always shown. Suggested severities come from a fixed table keyed by category and mutation (for example
`auth.omit` accepted on a state-changing operation → `high`; a missing header → `low`), documented in code and in the user
manual.

## Finding content

Expected behavior (statement and basis), the **observed summary** of each occurrence (a deterministic sentence built from the
decisive condition, the status code and a fixed set of response header names with redacted values; never a body excerpt),
remediation from a fixed text per category and mutation (static, versioned with the code, no model), and links: scenario and
version, runs and results, operation key, specification element pointer, and `supersedes` when an earlier version of the
scenario had a finding. The finding keeps its observed summaries after the session expires; the redacted evidence behind each
occurrence is session data and is shown only while available, otherwise "raw evidence no longer available". A response with a
secret-shaped value is described as "secret-like value present at <path>" and the value is never stored.

## Finding lifecycle and occurrences

Finding id is `sf-` + hash of scenario id and version. `open` (initial) → `accepted-risk` | `false-positive` | `resolved`, any change
with a note and time in `history`, and any status can return to `open`. For a `failed` result of a scenario version:

| Existing finding for this version | Effect |
|---|---|
| none | create it `open` with one occurrence |
| `open` | append an occurrence, update `occurrenceCount`, `latestFailedAt` and the latest confidence |
| `resolved` (asserted or verified) | append an occurrence, set `open`, record "reopened by occurrence" in `history` |
| `accepted-risk` or `false-positive` | append an occurrence, keep the status, set `unreviewedOccurrence = true` |

`PATCH` with `acknowledgeOccurrences: true` clears `unreviewedOccurrence` and records it. `resolved` is `engineer-asserted` until a
later result of the same version is `passed`, then `verified-by-rerun`. A material edit creates a new scenario version; its
first failure creates a separate finding with `supersedes` naming the earlier version's finding (FR-058). Counts and reports count
findings; occurrence totals are shown beside them and never added to them.

## Test obligations

Condition truth table incl. every indeterminate cause; outcome precedence; at-most-one-finding-per-scenario-version with
`occurrenceCount` equal to the number of failed results over any number of reruns (SC-011); reopening from `resolved`;
`accepted-risk` kept with `unreviewedOccurrence` set and cleared by acknowledgement; separate finding with `supersedes` after a
material edit; no finding for other outcomes; confidence rules; severity never raised; determinism (evaluate twice equal);
finding history and occurrence immutability; verified-by-rerun transition; observed summary never contains a body excerpt;
findings survive a forced session expiry with `evidenceAvailable` false; seeded-secret corpus over findings and summaries.
