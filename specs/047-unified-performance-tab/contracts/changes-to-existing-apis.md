# Changes to existing contracts (AP-047)

| Contract | Change | Compatible |
|---|---|---|
| `contracts/reselect-api.md` | New `POST /api/chain-plans/:planId/reselect` | Additive |
| `specs/037-request-chain-performance/contracts/chain-plan-api.md` | `POST /seed`: the `quick_test_not_found` message now reads "Upload a specification in Performance first." (code and status unchanged) | Yes (text only) |
| `specs/032-quick-performance-test/contracts/quick-performance-api.md` | None. `GET/POST /api/quick-performance` keep their contract; they are the session's uploaded-specification store | Yes |
| `GET/…/api/chain-plans/*` runs, data sets, script, debug | None | Yes |
| Shared domain | New types and pure helpers listed in `data-model.md` | Additive |

## UI contract changes (navigation and ids)

| Item | Before | After |
|---|---|---|
| Top-level view ids | `quick-performance`, `performance-plans` | `performance` |
| Tab label | "Quick Performance Test", "Performance Plans" | "Performance" |
| Start-screen cards | two | one |
| Handover from other views | `onOpenChainPlan(planId)` opens Performance Plans | `onOpenPerformancePlan(planId)` opens Performance on the Plan step |
| Test ids | `quick-performance-page`, `request-chain-plans-page`, `quick-performance-plan` | `performance-page`, `performance-path`, `performance-home`; plan-editor test ids kept |
| Palette commands | one per old tab | one "Performance" |

No stored value, run source label (`quick`, `guided`, `collection` legacy labels) or report changes.
