import type {
  CoverageCategoryCoverage,
  CoverageCause,
  CoverageFilter,
  CoverageMetric,
  CoveragePriority,
  CoverageRequirementGroup,
  CoverageRequirementResult,
  CoverageSnapshot,
  CoverageState,
  ScenarioVerdict,
} from "@apipilot/shared-domain";
import type { StatusTone } from "../StatusBadge";

/**
 * Pure presentation helpers for the coverage view. No domain decisions live here: every number,
 * state and priority arrives already computed by the backend, and this module only words and
 * groups them (CLAUDE.md section 43: styling stays separate from business logic).
 */

export const STATE_LABELS: Record<CoverageState, string> = {
  "not-covered": "Not covered",
  "generated-not-executed": "Generated, not executed",
  "executed-failed": "Executed, failed",
  verified: "Verified",
  inconclusive: "Inconclusive",
  stale: "Stale: re-run required",
};

/** Why a requirement is not simply verified, in plain words (shown beside its state). */
export const CAUSE_LABELS: Record<CoverageCause, string> = {
  "assertion-failed": "assertion failed",
  "transport-error": "no response (transport error)",
  "check-not-evaluated": "a check could not be evaluated",
  "no-relevant-check": "no relevant check was evaluated",
  "request-edited": "request edited before the run",
  "blocked-by-dependency": "blocked by a failed dependency",
  "run-cancelled": "run cancelled",
  "not-reached": "run ended before it was reached",
  "never-run": "never run",
  "not-in-selected-run": "not in the selected run",
};

export const VERDICT_LABELS: Record<ScenarioVerdict, string> = {
  passed: "Passed",
  failed: "Failed",
  inconclusive: "Inconclusive",
  "not-executed": "Not executed",
};

export const VERDICT_TONES: Record<ScenarioVerdict, StatusTone> = {
  passed: "success",
  failed: "danger",
  inconclusive: "warning",
  "not-executed": "info",
};

export const GROUP_LABELS: Record<CoverageRequirementGroup, string> = {
  positive: "Positive",
  negative: "Negative",
  boundary: "Boundary",
  unclassified: "Unclassified",
};

export const CATEGORY_TITLES: Record<CoverageCategoryCoverage["group"], string> = {
  positive: "Positive / happy path",
  negative: "Negative / invalid input",
  boundary: "Boundary / edge conditions",
  security: "Security / authorization",
};

/** Gap-type filter options (coverage-rules.md 13.2). */
export const GAP_KIND_LABELS: Record<NonNullable<CoverageFilter["gapKind"]>, string> = {
  missing: "Missing coverage",
  failed: "Failed verification",
  insufficient: "Insufficient evidence",
  stale: "Needs re-execution (stale)",
};

export const STATE_TONES: Record<CoverageState, StatusTone> = {
  "not-covered": "neutral",
  "generated-not-executed": "info",
  "executed-failed": "danger",
  verified: "success",
  inconclusive: "warning",
  stale: "neutral",
};

export const PRIORITY_LABELS: Record<CoveragePriority, string> = { high: "High", medium: "Medium", low: "Low" };
export const PRIORITY_TONES: Record<CoveragePriority, StatusTone> = { high: "danger", medium: "warning", low: "neutral" };

/** A metric's percentage as text; "not available" (never NaN) when its denominator is zero. */
export function formatPercentage(metric: Pick<CoverageMetric, "percentage">): string {
  return metric.percentage === null ? "not available" : `${metric.percentage}%`;
}

export function formatFraction(numerator: number, denominator: number): string {
  return `${numerator} / ${denominator}`;
}

/** `2026-10-10T11:00:00.000Z` -> `2026-10-10 11:00 UTC`; the raw value if it is not a date. */
export function formatTimestamp(value: string | undefined): string {
  if (!value) return "None";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface BreakdownSegment {
  key: "verified" | "failed" | "inconclusive" | "stale" | "generated" | "uncovered";
  label: string;
  count: number;
  /** Literal class strings so Tailwind's scanner sees them. */
  className: string;
}

export interface Breakdown {
  title: string;
  total: number;
  segments: BreakdownSegment[];
}

const SEGMENTS: Omit<BreakdownSegment, "count">[] = [
  { key: "verified", label: "Verified", className: "bg-success-600" },
  { key: "failed", label: "Executed, failed", className: "bg-danger-600" },
  { key: "inconclusive", label: "Inconclusive", className: "bg-warning-600" },
  { key: "stale", label: "Stale: re-run required", className: "bg-muted" },
  { key: "generated", label: "Generated, not executed", className: "bg-info-600" },
  { key: "uncovered", label: "Not covered", className: "bg-surface-strong" },
];

const SEGMENT_OF_STATE: Record<CoverageState, BreakdownSegment["key"]> = {
  verified: "verified",
  "executed-failed": "failed",
  inconclusive: "inconclusive",
  stale: "stale",
  "generated-not-executed": "generated",
  "not-covered": "uncovered",
};

/** One bar from per-state counts. The six segments partition `total`; each state has exactly one segment. */
export function breakdownFromCounts(title: string, counts: Record<CoverageState, number>): Breakdown {
  const segments = SEGMENTS.map((segment) => ({ ...segment, count: 0 }));
  let total = 0;
  for (const state of Object.keys(counts) as CoverageState[]) {
    const segment = segments.find((s) => s.key === SEGMENT_OF_STATE[state]);
    if (segment) segment.count += counts[state];
    total += counts[state];
  }
  return { title, total, segments };
}

/**
 * Splits the requirements of the given kinds into the six segments of one breakdown bar (verified,
 * executed-failed, inconclusive, stale, generated not executed, not covered). The counts add up to `total`.
 */
export function breakdownFor(
  title: string,
  requirements: readonly CoverageRequirementResult[],
  kinds: readonly CoverageRequirementResult["kind"][],
): Breakdown {
  const counts = Object.fromEntries(Object.keys(SEGMENT_OF_STATE).map((s) => [s, 0])) as Record<CoverageState, number>;
  for (const requirement of requirements) {
    if (kinds.includes(requirement.kind)) counts[requirement.state] += 1;
  }
  return breakdownFromCounts(title, counts);
}

/** Text a screen reader hears for a bar: every segment's count, then the total. */
export function breakdownLabel(breakdown: Breakdown): string {
  const parts = breakdown.segments.map((s) => `${s.count} ${s.label.toLowerCase()}`);
  return `${breakdown.title}: ${parts.join(", ")}, of ${breakdown.total}`;
}

/** States in the order a row lists them: problems first, verified last. */
export const STATE_DISPLAY_ORDER: readonly CoverageState[] = [
  "executed-failed",
  "not-covered",
  "inconclusive",
  "stale",
  "generated-not-executed",
  "verified",
];

/** The states present in a row's counts, worst first, as `[state, count]` pairs. */
export function presentStates(counts: Record<CoverageState, number>): [CoverageState, number][] {
  return STATE_DISPLAY_ORDER.filter((state) => counts[state] > 0).map((state) => [state, counts[state]]);
}

/** The scope every figure on the page refers to, in words (coverage-rules.md 13.1). */
export function scopeLabel(snapshot: CoverageSnapshot, filter: CoverageFilter, filtered: boolean): string {
  const total = snapshot.totals.operations;
  if (!filtered) return `All ${total} eligible operations`;
  const parts: string[] = [];
  if (filter.q) parts.push(`endpoint contains "${filter.q}"`);
  if (filter.methods?.length) parts.push(`method ${filter.methods.join(", ")}`);
  if (filter.states?.length) parts.push(`state ${filter.states.map((s) => STATE_LABELS[s].toLowerCase()).join(", ")}`);
  if (filter.category) parts.push(`category ${filter.category}`);
  if (filter.priorities?.length) parts.push(`priority ${filter.priorities.join(", ")}`);
  if (filter.gapKind) parts.push(`gap type ${GAP_KIND_LABELS[filter.gapKind].toLowerCase()}`);
  return `Filtered: ${snapshot.operations.length} of ${total} operations (${parts.join("; ")})`;
}

/** The evidence the figures come from, in words: mode, contributing runs, environment, excluded runs. */
export function evidenceLabel(snapshot: CoverageSnapshot): string {
  const exec = snapshot.execution;
  if (exec.evidenceByRun.length === 0) return "No execution evidence";
  if (exec.evidenceMode === "single-run") return `Single run ${exec.selectedRunId ?? ""}`.trim();
  const runs = exec.evidenceByRun.map((r) => `${r.runId} (${r.scenarios})`).join(", ");
  return `Latest qualifying result per scenario from ${runs}`;
}

/** Percentage of `numerator / denominator` as text, `not available (0 eligible)` for an empty denominator. */
export function formatRatio(numerator: number, denominator: number): string {
  if (denominator === 0) return "not available (0 eligible)";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}
