import type { LatencyPercentiles, LatencySummary } from "@apipilot/shared-domain";

/**
 * A fixed log-linear latency histogram (specs/031-k6-performance-testing research D11). Buckets grow
 * by 2% from 0.01 ms, so a bucket's geometric midpoint is within 1% of every value in it, and
 * memory stays constant however many requests a run sends. Percentiles use the nearest-rank
 * definition and are deterministic for the same samples. The minimum, maximum and mean are kept
 * exactly beside the buckets (FR-036, amended 2026-09-30).
 */
const MIN_MS = 0.01;
const RATIO = 1.02;
const LOG_RATIO = Math.log(RATIO);
/** 0.01 ms × 1.02^906 is just over 10 minutes; anything above lands in the last bucket. */
const BUCKET_COUNT = 907;

export class LatencyHistogram {
  private readonly counts = new Map<number, number>();
  private total = 0;
  private sum = 0;
  private min = Number.POSITIVE_INFINITY;
  private max = Number.NEGATIVE_INFINITY;

  add(valueMs: number): void {
    this.sum += valueMs;
    this.min = Math.min(this.min, valueMs);
    this.max = Math.max(this.max, valueMs);
    const index = valueMs <= MIN_MS ? 0 : Math.min(BUCKET_COUNT - 1, Math.floor(Math.log(valueMs / MIN_MS) / LOG_RATIO));
    this.counts.set(index, (this.counts.get(index) ?? 0) + 1);
    this.total += 1;
  }

  get count(): number {
    return this.total;
  }

  /**
   * Adds another histogram's samples to this one (AP-034 research R14: a user script's timeline
   * doubles its bucket width by merging neighbouring buckets). Exact, because buckets are fixed.
   */
  merge(other: LatencyHistogram): void {
    for (const [index, count] of other.counts) this.counts.set(index, (this.counts.get(index) ?? 0) + count);
    this.total += other.total;
    this.sum += other.sum;
    this.min = Math.min(this.min, other.min);
    this.max = Math.max(this.max, other.max);
  }

  percentile(p: number): number | null {
    if (this.total === 0) return null;
    const rank = Math.max(1, Math.ceil((p / 100) * this.total));
    let seen = 0;
    for (const index of [...this.counts.keys()].sort((a, b) => a - b)) {
      seen += this.counts.get(index)!;
      if (seen >= rank) return Number((MIN_MS * RATIO ** (index + 0.5)).toPrecision(6));
    }
    return null;
  }

  percentiles(): LatencyPercentiles | null {
    if (this.total === 0) return null;
    return { p50: this.percentile(50)!, p90: this.percentile(90)!, p95: this.percentile(95)!, p99: this.percentile(99)! };
  }

  /** Rounded to 0.01 ms. Samples arrive in stream order, so the mean is the same for the same stream. */
  summary(): LatencySummary | null {
    if (this.total === 0) return null;
    const round2 = (value: number) => Math.round(value * 100) / 100;
    return { min: round2(this.min), mean: round2(this.sum / this.total), max: round2(this.max) };
  }
}
