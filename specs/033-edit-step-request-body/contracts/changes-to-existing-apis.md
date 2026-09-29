# Contract Changes to Existing APIs (AP-033)

AP-033 changes the shipped AP-029 and AP-032 performance contracts. Each change is additive and
is stated with the requirement that makes it intentional (constitution XXVI; CLAUDE.md §23).

Source contracts:
- [specs/031 contracts/performance-api.md](../../031-k6-performance-testing/contracts/performance-api.md)
- [specs/032 contracts/quick-performance-api.md](../../032-quick-performance-test/contracts/quick-performance-api.md)

| Change | Before | After | Requirement |
|---|---|---|---|
| `PUT /plan` body | No body field | `bodyEdits` accepted | FR-003, FR-017 |
| `PUT /plan` errors | — | `invalid_body_edit`, `body_not_accepted`, `body_too_large`, `invalid_body`, `reserved_reference`, `body_secret_literal` (400) | FR-004, FR-012a, research R6 |
| `PerformancePlan` | — | `bodyEdits`, `bodyEditNotices`, `discardedBodyEdits` | FR-008, FR-010, FR-018 |
| `PerformanceStep` | — | Optional `bodyEdited: true` | FR-008, FR-014 |
| `plan.fingerprint` | Over the existing fields | Also over `bodyEdits` when not empty; unchanged for a plan with no edits | FR-007, FR-015, research R10 |
| `StepRequestPreview` | View-only; body or `null` | Adds `bodyStatus` and `bodyEdit` | FR-001, FR-005 |
| AP-032 FR-008 "view-only" | The whole request | Headers, query and path parameters stay view-only; the body is editable for steps in the plan | spec Relationship section |
| `POST /plan/reset` | Keeps load profile, thresholds, exclusions and expected statuses | Also keeps body edits | research R9 |
| `planSnapshot` of a run | The whole plan | The plan with `bodyEdits` and `discardedBodyEdits` emptied; `bodyEdited` flags kept | FR-014 |
| HTML report | — | "Body edited by you" per step, plus a count in provenance | FR-014 |
| Quick replace confirmation (UI) | Says the plan is replaced | Also says body edits are discarded | research R9 |

Unchanged: every route, the gates, the run check order and the XVII conditions it enforces, the
script's structure, the environment template's format, the SQLite schema (no migration), and the
script and template bytes of any plan without body edits.
