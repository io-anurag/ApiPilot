# Data Model: Unified Performance Tab (AP-047)

**No stored entity changes.** `ChainPlan`, `Chain`, `ChainStep`, `LoadProfile`, `PerformanceThreshold`, data sets,
runs, reports, environments and the session's quick test keep their shapes, storage and migrations. Everything new
is view state in the browser, plus one additive operation on existing plans (`contracts/reselect-api.md`).

## Shared domain additions (`packages/shared-domain`)

Only what both backend and frontend need (CLAUDE.md §4).

### `ReselectMode` and request/response types

```text
ReselectMode            = "merge" | "reset"
ReselectRequest         = { revision: number; mode: ReselectMode; selectedOperationKeys: string[]; confirmRemoveEdited?: boolean }
ReselectEditedRemoval   = { chainId: string; operationKey: string; reasons: ("step-changed" | "step-added")[] }
ReselectOutcome         = { view: ChainPlanView; added: string[]; removed: string[]; keptEdited: string[] }
```

`ReselectEditedRemoval` is what the "this would remove edited steps" refusal lists (FR-016).

### Derived-edit helpers (pure, shared so the UI and server agree)

```text
isChainEdited(chain: Chain): boolean          // any step.changed, or any step.source.kind === "added"
seededOperationKeys(plan: ChainPlan): string[] // operationKey of every step with source.kind === "operation"
isPlanEdited(plan: ChainPlan): boolean         // see research R3
```

These are pure functions over existing fields; they add no stored field.

## View state (frontend only, in memory)

### PathState

| Field | Type | Meaning |
|---|---|---|
| `view` | `"home" \| "path"` | Entry screen or the five-step path |
| `draft` | `DraftTest \| null` | Unfinished test with no plan yet |
| `planId` | `string \| null` | The plan the path is working on, once it exists |
| `step` | `PathStep` | Current step |
| `reached` | `number` | Highest step index reached; steps up to it are selectable |
| `parked` | `boolean` | The draft was left; the entry screen offers Resume and Discard |
| `panel` | `"closed" \| "change-operations"` | Side panel on the Plan step |

`PathStep = "source" | "operations" | "plan" | "load" | "run"`

### DraftTest

| Field | Type | Meaning |
|---|---|---|
| `source` | `"specification" \| "workflow" \| "collection" \| "empty"` | Chosen source |
| `selection` | `ReadonlySet<string>` | Operation keys (specification) or request ids (collection) |
| `replacingSpecification` | `boolean` | Upload panel shown over an existing spec |
| `collectionId` | `string \| null` | Collection source only |

A draft exists only until the first move past Operations (or immediately for an empty plan), when a plan is
created and saved; from then the plan is the source of truth and the draft is cleared (FR-011, FR-022).

### State transitions

```text
home --pick source--> path(step = entryStep(source, specLoaded))
entryStep: specification & specLoaded -> operations ; specification & !specLoaded -> source ;
           workflow | collection -> operations (summary / selection per R8) ; empty -> plan (plan created)
home --open plan--> path(step = plan, reached = run)
path --"← Plans" with no plan--> home (draft.parked = true)
path --"← Plans" with plan--> home (draft = null)
operations --Next, no plan--> create plan (seed) --> plan
operations --Next, plan exists--> reselect(merge) [warn if edited removals] --> plan
plan --Change operations apply--> reselect(merge) [warn if edited removals] --> plan
plan --Reset to seed (confirmed)--> reselect(reset) --> plan
```

### Step gating (Next availability and the reason text)

| Step | Next available when | Reason shown otherwise |
|---|---|---|
| Source | source chosen and, for a specification, one is analysed and not being replaced | "Upload the specification to continue" |
| Operations | selection is not empty | "Choose at least one" |
| Plan | name not blank and the plan has at least one step | "Add at least one step" |
| Load | the existing load-profile, threshold and think-time validation passes | the existing field messages |
| Run | n/a (last step) | n/a |

Selecting a reached step is always allowed except the skipped Operations step of an empty plan (FR-006, FR-008).

## Merge and reset semantics (server, specification plans)

Inputs: the plan, its previous selection `seededOperationKeys(plan)`, the new `selectedOperationKeys`.

| Case | Merge result | Reset result |
|---|---|---|
| Key in both | chain kept untouched | chain rebuilt from the specification |
| Key only in new selection | chain seeded and appended after existing chains | chain seeded in selection order |
| Key only in previous selection, chain not edited | chain removed | n/a (all rebuilt) |
| Key only in previous selection, chain edited | refused with `ReselectEditedRemoval[]` unless `confirmRemoveEdited` | n/a |
| Engineer-created chain | always kept | removed (reset discards added chains) |
| Credentials chain | added when a newly selected step needs a token source; kept if edited; removed only if no remaining step needs it and it is not edited | rebuilt |
| Data sets, load profile, thresholds, environment, name, runs | never touched | never touched |

The saved plan's revision is checked as for `PUT`; a stale revision returns the existing `plan_revision_conflict`.
