import {
  coveragePercentage,
  type CoverageDimensionKind,
  type CoverageMetric,
  type CoverageMetricDimension,
} from "@apipilot/shared-domain";

/**
 * Builds one metric with its numerator, denominator and basis (FR-007). A zero denominator yields
 * `percentage: null` and `available: false`; a numerator above its denominator is a programming
 * error and is refused rather than displayed.
 */
export function makeMetric(
  id: string,
  dimension: CoverageMetricDimension,
  kind: CoverageDimensionKind | "assertion",
  label: string,
  numerator: number,
  denominator: number,
  basis: string,
): CoverageMetric {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 0 || denominator < 0) {
    throw new RangeError(`Metric "${id}" requires non-negative integer counts.`);
  }
  if (numerator > denominator) {
    throw new RangeError(`Metric "${id}" numerator (${numerator}) exceeds its denominator (${denominator}).`);
  }
  return {
    id,
    dimension,
    kind,
    label,
    numerator,
    denominator,
    percentage: coveragePercentage(numerator, denominator),
    available: denominator > 0,
    basis,
  };
}
