/**
 * Pre-flight viability estimation (specs/013-ai-enhancement-viability research.md Decision 6,
 * FR-014/FR-015).
 *
 * Exists because the AI enhancement stage could previously spend its entire time budget
 * discovering something knowable before it started: the reported defect asked a model running at
 * ~0.5 tokens/second to produce 1,024 tokens within 300 seconds — an over-run of roughly 6.9x that
 * no amount of waiting could resolve. Refusing up front turns a five-minute silent loss into an
 * immediate, explainable one.
 *
 * Deliberately pure and total, with no I/O and no clock access, so it is directly unit-testable
 * and deterministic under test (constitution XXI, XXIV).
 */

/** Observed or configured generation throughput, in milliseconds per token. */
export interface ViabilityRates {
  prefillMsPerToken: number;
  decodeMsPerToken: number;
}

export interface ViabilityInput {
  /** Estimated tokens in the prompt that would be sent. */
  promptTokens: number;
  /** The output allowance for this request. */
  maxOutputTokens: number;
  rates: ViabilityRates;
  /** The configured per-request time budget. */
  budgetMs: number;
  /**
   * How far a projection may exceed the budget before the run is refused. Above 1.0 so a marginal
   * misestimate never blocks a run that would have succeeded.
   */
  safetyFactor: number;
}

/** The verdict, carrying enough detail to explain itself to a user (FR-015). */
export interface ViabilityEstimate {
  promptTokens: number;
  maxOutputTokens: number;
  projectedMs: number;
  budgetMs: number;
  safetyFactor: number;
  viable: boolean;
}

/**
 * Projects how long one inference would take and decides whether to attempt it.
 *
 * The projection is an approximation — hardware varies by an order of magnitude and prefill/decode
 * rates are themselves estimates — and it does not need to be better than that. It exists to catch
 * the hopeless case, not to police borderline ones, which is why `safetyFactor` biases every
 * marginal call toward *attempting* the work: wrongly refusing a viable run would be a worse
 * failure than wrongly attempting one, since the timeout still backstops the latter.
 *
 * Guards against non-finite or non-positive inputs by treating them as "cannot project", which
 * resolves to viable — an unusable estimate must never be the reason work is refused.
 */
export function estimateViability(input: ViabilityInput): ViabilityEstimate {
  const { promptTokens, maxOutputTokens, rates, budgetMs, safetyFactor } = input;

  const projectedMs =
    promptTokens * rates.prefillMsPerToken + maxOutputTokens * rates.decodeMsPerToken;

  const projectionUsable =
    Number.isFinite(projectedMs) &&
    projectedMs > 0 &&
    Number.isFinite(budgetMs) &&
    budgetMs > 0 &&
    Number.isFinite(safetyFactor) &&
    safetyFactor > 0;

  return {
    promptTokens,
    maxOutputTokens,
    projectedMs,
    budgetMs,
    safetyFactor,
    viable: projectionUsable ? projectedMs <= budgetMs * safetyFactor : true,
  };
}

/**
 * Renders a duration the way a person reads one, for user-facing explanations. Raw milliseconds
 * are an internal detail and must not appear in anything the user sees (FR-024) — the message this
 * feature replaces leaked "300000ms" directly into the UI.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "no time at all";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `about ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return remainder === 0
    ? `about ${hourPart}`
    : `about ${hourPart} ${remainder} minute${remainder === 1 ? "" : "s"}`;
}
