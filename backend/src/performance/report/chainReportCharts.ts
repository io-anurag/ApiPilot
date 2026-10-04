import type { StepTimelinePoint, TimelinePoint } from "@apipilot/shared-domain";
import { clock, countScale, escapeHtml, formatCount, latencyScale, ms, timeTickMs } from "./renderHtmlReport";

/**
 * Line charts of the request-chain report: server-computed inline SVG, no script. Every chart shares
 * one time axis (each point is the middle of a timeline interval), so charts line up when read
 * together. Hover text uses SVG `<title>`; each chart also has a numeric table elsewhere in the report
 * or a summary in its `aria-label`, so no figure is available only from color.
 */

const FULL_WIDTH = 1200;
/** The paired charts sit side by side, so their viewBox is narrower and text keeps its size. */
export const HALF_WIDTH = 600;
const LEFT = 72;
const RIGHT = 24;
const TOP = 16;
const PLOT_HEIGHT = 190;
const BOTTOM_PAD = 40;

const round1 = (value: number) => Math.round(value * 10) / 10;

interface Series {
  label: string;
  /** One value per point; `null` breaks the line (a bucket with no measurement is not drawn as 0). */
  values: (number | null)[];
  className: string;
  area?: boolean;
  peakDot?: string;
}

interface ChartInput {
  offsets: number[];
  bucketMs: number;
  series: Series[];
  scale: ReturnType<typeof countScale>;
  /** A dashed horizontal reference, drawn only when it lies on the scale. */
  limit?: { value: number; label: string };
  /** Hover text per point. */
  tips: string[];
  summary: string;
  width?: number;
}

function lineChart(input: ChartInput): string {
  const { offsets, bucketMs, series, scale, limit, tips, summary } = input;
  const WIDTH = input.width ?? FULL_WIDTH;
  const columns = offsets[offsets.length - 1] / bucketMs + 1;
  const totalMs = columns * bucketMs;
  const columnWidth = (WIDTH - LEFT - RIGHT) / columns;
  const bottom = TOP + PLOT_HEIGHT;
  const height = bottom + BOTTOM_PAD;
  const x = (offsetMs: number) => LEFT + (offsetMs / bucketMs) * columnWidth;
  const middle = (offsetMs: number) => round1(x(offsetMs) + columnWidth / 2);
  const parts: string[] = [];

  for (let offset = 0; offset <= totalMs; offset += timeTickMs(totalMs)) {
    const at = round1(x(offset));
    parts.push(`<line class="grid" x1="${at}" y1="${TOP}" x2="${at}" y2="${bottom}"></line>`);
    parts.push(`<text class="axis" x="${at}" y="${bottom + 16}" text-anchor="middle">${clock(offset)}</text>`);
  }
  parts.push(`<text class="axis" x="${round1((WIDTH - LEFT - RIGHT) / 2 + LEFT)}" y="${bottom + 34}" text-anchor="middle">Elapsed time · each point is a ${clock(bucketMs)} interval</text>`);
  for (const tick of scale.ticks) {
    const at = round1(scale.y(tick.value));
    parts.push(`<line class="grid" x1="${LEFT}" y1="${at}" x2="${WIDTH - RIGHT}" y2="${at}"></line>`);
    parts.push(`<text class="axis" x="${LEFT - 8}" y="${round1(at + 4)}" text-anchor="end">${escapeHtml(tick.label)}</text>`);
  }
  parts.push(`<line class="baseline" x1="${LEFT}" y1="${bottom}" x2="${WIDTH - RIGHT}" y2="${bottom}"></line>`);

  if (limit) {
    const at = round1(scale.y(limit.value));
    if (at >= TOP && at <= bottom) {
      parts.push(`<line class="limit" x1="${LEFT}" y1="${at}" x2="${WIDTH - RIGHT}" y2="${at}"></line>`);
      parts.push(`<text class="limit-text" x="${WIDTH - RIGHT - 4}" y="${round1(Math.max(TOP + 10, at - 5))}" text-anchor="end">${escapeHtml(limit.label)}</text>`);
    }
  }

  for (const entry of series) {
    // Split at nulls so a gap stays a gap.
    const segments: string[][] = [[]];
    offsets.forEach((offset, index) => {
      const value = entry.values[index];
      if (value === null || value === undefined) segments.push([]);
      else segments[segments.length - 1].push(`${middle(offset)},${round1(scale.y(value))}`);
    });
    for (const segment of segments.filter((candidate) => candidate.length > 0)) {
      if (entry.area && segment.length > 1) {
        const first = segment[0].split(",")[0];
        const last = segment[segment.length - 1].split(",")[0];
        parts.push(`<polygon class="area-${entry.className.replace("l-", "")}" points="${first},${bottom} ${segment.join(" ")} ${last},${bottom}"></polygon>`);
      }
      // A single isolated point has no line to draw, so it is drawn as a dot.
      if (segment.length === 1) {
        const [cx, cy] = segment[0].split(",");
        parts.push(`<circle class="dot-lat" cx="${cx}" cy="${cy}" r="3"></circle>`);
      } else parts.push(`<polyline class="line ${entry.className}" points="${segment.join(" ")}"></polyline>`);
    }
    if (entry.peakDot) {
      const numeric = entry.values.flatMap((value, index) => (value === null ? [] : [{ value, index }]));
      if (numeric.length > 0) {
        const peak = numeric.reduce((best, candidate) => (candidate.value > best.value ? candidate : best));
        parts.push(`<circle class="${entry.peakDot}" cx="${middle(offsets[peak.index])}" cy="${round1(scale.y(peak.value))}" r="4.5"></circle>`);
      }
    }
  }

  offsets.forEach((offset, index) => {
    parts.push(`<rect class="hit" x="${round1(x(offset))}" y="${TOP - 4}" width="${round1(columnWidth)}" height="${PLOT_HEIGHT + 8}"><title>${escapeHtml(tips[index])}</title></rect>`);
  });
  return `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escapeHtml(summary)}">${parts.join("")}</svg>`;
}

function legendOf(entries: { cls: string; text: string }[]): string {
  return `<div class="legend">${entries.map((entry) => `<span><i class="sw ${entry.cls}"></i>${escapeHtml(entry.text)}</span>`).join("")}</div>`;
}

export const EMPTY_CHART = '<p class="muted">No timeline was recorded.</p>';

export function virtualUsersChart(points: TimelinePoint[], bucketMs: number): string {
  if (points.length === 0) return EMPTY_CHART;
  const peak = Math.max(0, ...points.map((point) => point.virtualUsers));
  const chart = lineChart({
    offsets: points.map((point) => point.offsetMs),
    bucketMs,
    series: [{ label: "Virtual users", values: points.map((point) => point.virtualUsers), className: "l-vus", area: true }],
    scale: countScale(peak, TOP, TOP + PLOT_HEIGHT),
    tips: points.map((point) => `${clock(point.offsetMs)}–${clock(point.offsetMs + bucketMs)} · ${formatCount(point.virtualUsers)} virtual users`),
    summary: `Virtual users over time; peak ${formatCount(peak)}.`,
    width: HALF_WIDTH,
  });
  return `${legendOf([{ cls: "l-vus", text: `Virtual users · peak ${formatCount(peak)}` }])}${chart}`;
}

/** Requests per second and failed requests per second, per interval. */
export function throughputChart(points: TimelinePoint[], bucketMs: number): string {
  if (points.length === 0) return EMPTY_CHART;
  const seconds = bucketMs / 1000;
  const rate = points.map((point) => Math.round((point.requests / seconds) * 100) / 100);
  const failed = points.map((point) => Math.round((point.errors / seconds) * 100) / 100);
  const peak = Math.max(0, ...rate);
  const failingIntervals = points.filter((point) => point.errors > 0).length;
  const chart = lineChart({
    offsets: points.map((point) => point.offsetMs),
    bucketMs,
    series: [
      { label: "Requests per second", values: rate, className: "l-rate" },
      { label: "Failed requests per second", values: failed, className: "l-fail" },
    ],
    scale: countScale(peak, TOP, TOP + PLOT_HEIGHT),
    tips: points.map((point) => `${clock(point.offsetMs)}–${clock(point.offsetMs + bucketMs)} · ${formatCount(point.requests)} requests, ${formatCount(point.errors)} failed`),
    summary: `Requests per second over time; peak ${formatCount(peak)}; ${failingIntervals} of ${points.length} intervals had failures.`,
    width: HALF_WIDTH,
  });
  return `${legendOf([
    { cls: "l-rate", text: `Requests/s · peak ${formatCount(peak)}` },
    { cls: "l-fail dash", text: `Failed/s · ${failingIntervals} of ${points.length} intervals had failures` },
  ])}${chart}`;
}

/** The run's p95 latency per interval, with the run's p95 limit when a threshold sets one. */
export function latencyChart(points: TimelinePoint[], bucketMs: number, p95Limit: number | null): string {
  const measured = points.filter((point) => point.p95Ms !== null).map((point) => point.p95Ms!);
  if (points.length === 0 || measured.length === 0) return EMPTY_CHART;
  const peak = Math.max(...measured);
  const peakPoint = points.find((point) => point.p95Ms === peak)!;
  const scale = latencyScale(p95Limit === null ? measured : [...measured, p95Limit], TOP, TOP + PLOT_HEIGHT);
  const chart = lineChart({
    offsets: points.map((point) => point.offsetMs),
    bucketMs,
    series: [{ label: "p95 latency", values: points.map((point) => point.p95Ms), className: "l-lat", area: true, peakDot: "dot-lat" }],
    scale,
    limit: p95Limit === null ? undefined : { value: p95Limit, label: `limit ${ms(p95Limit)}` },
    tips: points.map((point) => `${clock(point.offsetMs)}–${clock(point.offsetMs + bucketMs)} · p95 ${ms(point.p95Ms)} · ${formatCount(point.requests)} requests`),
    summary: `p95 latency over time; peak ${ms(peak)} at ${clock(peakPoint.offsetMs)}${p95Limit === null ? "" : `; the run's p95 limit is ${ms(p95Limit)}`}.`,
  });
  return `${legendOf([
    { cls: "l-lat", text: `p95 latency · peak ${ms(peak)} at ${clock(peakPoint.offsetMs)} · ${scale.note}` },
    ...(p95Limit === null ? [] : [{ cls: "limit dash", text: `Threshold ${ms(p95Limit)}` }]),
  ])}${chart}`;
}

export interface StepLine {
  label: string;
  timeline: StepTimelinePoint[];
}

const SERIES_LIMIT = 8;
const DASHES = ["d1", "d2", "d3"];

/** Each step's p95 per interval on one scale, up to eight steps; line style as well as color tells them apart. */
export function stepLatencyChart(steps: StepLine[], runPoints: TimelinePoint[], bucketMs: number): string {
  const lines = steps.filter((step) => step.timeline.some((point) => point.p95Ms !== null));
  if (lines.length === 0 || runPoints.length === 0) return "";
  const shown = lines.slice(0, SERIES_LIMIT);
  const offsets = runPoints.map((point) => point.offsetMs);
  const series: Series[] = shown.map((step, index) => {
    const byOffset = new Map(step.timeline.map((point) => [point.offsetMs, point.p95Ms]));
    return { label: step.label, values: offsets.map((offset) => byOffset.get(offset) ?? null), className: `s${index + 1} ${DASHES[index % 3]}` };
  });
  const values = series.flatMap((entry) => entry.values.flatMap((value) => (value === null ? [] : [value])));
  const chart = lineChart({
    offsets,
    bucketMs,
    series,
    scale: latencyScale(values, TOP, TOP + PLOT_HEIGHT),
    tips: offsets.map((offset, index) => {
      const cells = series.map((entry) => `${entry.label} ${ms(entry.values[index])}`).join(" · ");
      return `${clock(offset)}–${clock(offset + bucketMs)} · p95 ${cells}`;
    }),
    summary: `p95 latency over time for ${shown.length} steps on one scale.`,
  });
  const legend = `<div class="legend">${shown.map((entry, index) => `<span><i class="sw s${index + 1} ${index % 3 === 1 ? "dash" : index % 3 === 2 ? "dot" : ""}"></i>${escapeHtml(entry.label)}</span>`).join("")}</div>`;
  const omitted = lines.length > SERIES_LIMIT ? `<p class="small muted note">${formatCount(lines.length - SERIES_LIMIT)} more steps are in the table below.</p>` : "";
  return `${legend}${chart}${omitted}`;
}
