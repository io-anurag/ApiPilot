/**
 * Axis arithmetic for the live run graphs (AP-045): round tick values and a time axis that spans the
 * planned run. Pure, so the marks a person reads off a graph can be tested.
 */

/**
 * Five tick values, 0 and four equal steps up to a round maximum that is at least `max`, so the
 * gridlines of two axes with different units line up. With `integer` (counts), the top is at least 4, so no tick is a fraction.
 */
export function axisTicks(max: number, options: { integer?: boolean } = {}): number[] {
  const floor = options.integer ? 4 : 1;
  const safe = Number.isFinite(max) && max > floor ? max : floor;
  const raw = safe / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  return [0, 1, 2, 3, 4].map((index) => Math.round(index * step * 1e6) / 1e6);
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800, 3_600, 7_200];

/** Tick seconds for a time axis from 0 to `spanSeconds`, with at most `maxTicks` marks. */
export function timeTicks(spanSeconds: number, maxTicks = 8): number[] {
  const span = Math.max(1, spanSeconds);
  const step = TIME_STEPS.find((candidate) => span / candidate <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1]!;
  const ticks: number[] = [];
  for (let second = 0; second <= span + 1e-9; second += step) ticks.push(second);
  return ticks;
}

/** `m:ss`, or `h:mm:ss` from one hour. */
export function formatAxisTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const rest = whole % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

/** A tick label: whole numbers as they are, thousands abbreviated. */
export function formatTick(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/** The x extent of the graph, in seconds: the planned run when known, never less than what has been drawn. */
export function timeSpan(lastSecond: number, bucketSeconds: number, plannedSeconds: number | null): number {
  return Math.max(1, lastSecond + bucketSeconds, plannedSeconds ?? 0);
}
