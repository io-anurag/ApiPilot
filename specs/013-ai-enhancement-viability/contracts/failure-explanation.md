# Contract: Failure Explanation Mapping

**Feature**: `013-ai-enhancement-viability`
**Requirements**: FR-023, FR-024, FR-025, FR-026
**Research**: [Decision 9](../research.md)

Defines the total, pure mapping from an internal failure cause to the text a user reads. Lives in
the backend domain layer, not the frontend, so error semantics are not duplicated into
presentation (constitution IX, X).

## Signature

```ts
function explainFailure(
  cause: AIErrorCategory | "cancelled" | "not-viable",
  context: {
    projectedMs?: number;   // "not-viable" only
    budgetMs?: number;      // "not-viable" only
    operationLabel?: string;// "too-large" only, e.g. "GET /pets"
    readinessReason?: string;
  },
): FailureExplanation;
```

Pure and total: every input yields an explanation, no I/O, so it is unit-testable without a
provider (constitution XXI).

## Mapping

| Cause | Category | Summary | Next step | `retryable` |
| --- | --- | --- | --- | --- |
| `TIMEOUT` | `too-slow` | The local AI model was too slow to finish this on this machine. | Try a smaller specification, or see the setup notes on making local inference faster. | `false` |
| `"not-viable"` | `not-viable` | This specification needs about {projected} of AI processing, but the current limit is {budget}. | Enhance a smaller specification, or raise the inference time limit in your configuration. | `false` |
| `NOT_READY` | `unavailable` | The local AI model isn't ready yet. | {readinessReason in plain language}. Once it's ready, run enhancement again. | `true` |
| `LOAD_FAILED` | `unavailable` | The local AI model couldn't be loaded. | {readinessReason}. Check that the model files downloaded correctly, then try again. | `true` |
| `PROVIDER_UNAVAILABLE` | `unavailable` | Local AI is unavailable right now. | {readinessReason}. Deterministic scenarios are unaffected and ready to review. | `true` |
| `INVALID_RESPONSE` | `unusable-output` | The AI model replied with output that couldn't be used. | This can happen intermittently — running enhancement again often succeeds. | `true` |
| `INVALID_REQUEST` | `too-large` | Part of this specification is too large for the AI model to process in one piece{, starting with operationLabel}. | Enhancement covered everything else. Consider splitting that operation's schema. | `false` |
| `"cancelled"` | `cancelled` | AI enhancement was cancelled before it finished. | Any scenarios generated before you cancelled have been kept. | `true` |

Durations in user-facing text are rendered in human units ("about 34 minutes", "5 minutes"), never
raw milliseconds.

## Invariants

Enforced by unit test, not convention:

1. **No internal identifiers** (FR-024). Neither `summary` nor `nextStep` may contain: an error
   class name (`AIProviderError`, `StageNotActiveError`, …), an `AIErrorCategory` literal
   (`TIMEOUT`, `LOAD_FAILED`, …), an environment variable name (`AI_INFERENCE_TIMEOUT_MS`,
   `AI_MODEL_DTYPE`, …), a file path, a bare millisecond value, or a model identifier. Tested with
   a deny-list.

   The reported message this replaces —
   `"AI enhancement was skipped (TIMEOUT): Inference exceeded the configured timeout of 300000ms."` —
   violates this three times over: a category literal, an implementation constant, and raw
   milliseconds.

2. **No futile retry offered** (FR-025). `retryable` is `false` for `too-slow`, `not-viable`, and
   `too-large`, because under unchanged conditions the outcome is deterministic. The current UI
   offers an identical "Retry AI enhancement" control for every category, which after a timeout is
   a guaranteed repeat of a five-minute loss.

3. **Total.** Every `AIErrorCategory` member plus `"cancelled"` and `"not-viable"` maps to an
   explanation. A test enumerates the union so a future category cannot be added without one.

4. **Distinguishable** (FR-023). The three categories the spec requires —
   too slow, unavailable, unusable output — map to distinct `category` values with distinct text.

5. **Internal detail preserved** (FR-026). `aiErrorMessage` keeps its full internal string for
   logs. This mapping is additive; it removes no diagnostic information.

## Frontend rendering

The frontend renders `summary`, `nextStep`, and offers a retry control only when `retryable` is
`true`. It MUST NOT render `aiErrorMessage`.

Presentation uses the existing design system (constitution XXXIII): `StatusBadge` tones already
defined in the component, Tailwind semantic tokens (`warning-*`, `danger-*`), no new styling
vocabulary. State must not be conveyed by colour alone — the category text carries the meaning
independently.
