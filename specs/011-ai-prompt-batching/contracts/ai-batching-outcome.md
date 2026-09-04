# Contract Delta: `"partial"` AI Outcome Value

This feature makes an **additive** change to two existing, already-documented HTTP response
contracts. It does not add a new endpoint. Full request/response shapes and examples remain
defined in their owning specs:

- Dependency analysis: [specs/008-dependency-workflow-engine/contracts/api-dependency-workflow-api.md](../../008-dependency-workflow-engine/contracts/api-dependency-workflow-api.md)
- Scenario enhancement: [specs/005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md](../../005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md)

## What changes

Both `aiOutcome` (dependency analysis response) and `aiProviderOutcome` (enhancement
response) gain one new possible string value: **`"partial"`**.

| Value     | Meaning (new)                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partial` | The specification required more than one AI request (batch); at least one batch succeeded and at least one did not. Results from the successful batch(es) are merged with the deterministic baseline and returned — they are not discarded. |

No existing value's meaning changes. `"partial"` is only reachable for a specification whose
full `ApiModel` (or `ApiModel` + `TestModel`, for enhancement) did not fit in a single AI
request — see [data-model.md](./data-model.md) for the full outcome-derivation table.

## Example: dependency analysis response with a partial AI outcome

```json
{
  "requestId": "dep-analysis-...",
  "graph": {
    "relationships": ["...same shape as today, from successful batches only..."]
  },
  "workflows": ["...unaffected..."],
  "manualConfirmationCandidates": [],
  "cycles": [],
  "aiOutcome": "partial",
  "aiErrorCategory": "TIMEOUT",
  "aiErrorMessage": "AI provider timed out for 1 of 3 batches; deterministic relationships and partial AI results were preserved"
}
```

`aiErrorCategory`/`aiErrorMessage` describe the last failing batch encountered, consistent
with how these fields already behave for the single-batch failure case today — they are not
a per-batch list (see data-model.md's note on `EnhancementResult`/`DependencyAnalysisResult`
scope).

## Example: enhancement response with a partial AI outcome

```json
{
  "requestId": "enhance-...",
  "enhancedTestModel": {
    "scenarios": ["...deterministic + AI scenarios from successful batches..."]
  },
  "aiCandidates": {
    "added": ["..."],
    "deduplicated": [],
    "rejected": [],
    "nonExecutable": []
  },
  "aiProviderOutcome": "partial",
  "aiErrorCategory": "PROVIDER_UNAVAILABLE",
  "aiErrorMessage": "AI provider is unavailable for 2 of 4 batches; deterministic scenarios and partial AI results were preserved"
}
```

## Consumer impact

Any code that exhaustively switches over `AIProviderOutcome` or `DependencyAIOutcome`
(backend or frontend) will fail to compile until it adds a `"partial"` case — this is
intentional (TypeScript's closed-union exhaustiveness check surfacing every place that needs
an explicit decision, rather than a value silently falling through to a default/error branch).
Known consumers to check during implementation: the frontend AI-status/enhancement-review
components and any backend serialization/logging that lists outcome values by name.
