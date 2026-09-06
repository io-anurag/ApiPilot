# Contract: Work-Bounded Batch Sizing

**Feature**: `014-ai-batching-policy` | **Status**: Draft

Internal contract for `splitOperationsIntoBatches` in `backend/src/ai/requestBatching.ts`. This
function never crosses an HTTP boundary; its callers are the scenario-enhancement and
dependency-analysis AI passes.

## Change

The function gains a caller-supplied maximum operation count per unit. Sizing becomes
work-bounded first, context-bounded second.

```
splitOperationsIntoBatches(
  operations,
  buildPrompt,
  budgetChars,            // existing: context-capacity upper bound
  maxOperationsPerBatch,  // NEW: work bound, supplied per caller
)
```

## Behaviour

1. Operations are taken in specification order and grouped into runs of at most
   `maxOperationsPerBatch`.
2. Each resulting group is then checked against `budgetChars`. A group exceeding it is split further
   by the existing recursive halving.
3. A single operation that alone exceeds `budgetChars` becomes its own unit. It is still sent, and is
   expected to be refused by the provider's exact-fit guard as `INVALID_REQUEST` — reported as a named
   exclusion, never silently dropped.
4. `maxOperationsPerBatch` omitted or non-positive preserves today's context-only behaviour, so the
   change is additive for any caller not yet migrated.

## Invariants

| Invariant | Requirement |
| --- | --- |
| Every operation appears in exactly one unit | FR-006 |
| Unit order matches specification order | FR-005 |
| Identical input yields identical units | FR-005, SC-008 |
| Context capacity is never exceeded by the work bound | FR-002 |
| No unit is empty | — |

## Caller settings

| Caller | `maxOperationsPerBatch` | Basis |
| --- | --- | --- |
| Scenario enhancement | `1` | Measured: 2 and 3 operations both truncate (research.md Decision 1) |
| Dependency analysis | To be measured | Must satisfy SC-013; requires the prompt projection first (research.md Decisions 6, 7) |

## Test expectations

- 200 operations with `maxOperationsPerBatch: 1` yields exactly 200 units, each with one operation,
  in specification order.
- The same input yields byte-identical unit composition across repeated calls.
- A caller passing no work bound gets today's behaviour, verified against the existing tests.
- An operation whose prompt exceeds `budgetChars` is isolated into its own unit rather than merged or
  dropped.
