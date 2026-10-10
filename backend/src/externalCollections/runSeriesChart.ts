import { clock, formatCount, niceCeil, timeTickMs } from "../performance/report/renderHtmlReport";
import type { LiveSeriesView } from "../performance/live/liveSeries";

/**
 * The per-second graph of a collection run report (AP-045 US4, FR-014), as data. One pure function
 * turns the run's series into the figures to plot (rates, axis ticks, summary), and one more places
 * them in a box. The HTML report draws that layout as SVG and the PDF report as vector shapes, so both
 * draw the same figures by construction. Nothing here reads the clock or a random source.
 */

export interface SeriesChartPoint {
  /** First second of the step this point stands for, and the second after its last. */
  second: number;
  endSecond: number;
  requests: number;
  failures: number;
  /** Requests / failures divided by the step width, two decimals. */
  requestsPerSecond: number;
  failuresPerSecond: number;
}

export interface SeriesChart {
  bucketSeconds: number;
  /** The width of the plotted time axis: points x step width. */
  totalSeconds: number;
  points: SeriesChartPoint[];
  /** The top of the y axis, a round number at or above the peak rate. */
  axisMax: number;
  yTicks: { value: number; label: string }[];
  xTicks: { second: number; label: string }[];
  totals: { requests: number; failures: number };
  peak: number;
  failingSteps: number;
  /** One sentence with the same figures, for the text alternative. */
  summary: string;
  /** The line that explains what a point is. */
  note: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Null when no request was sent, so a report states that plainly instead of drawing an empty graph. */
export function buildSeriesChart(series: LiveSeriesView): SeriesChart | null {
  const width = Math.max(1, Math.floor(series.bucketSeconds) || 1);
  const points: SeriesChartPoint[] = series.points.map((point) => ({
    second: point.second,
    endSecond: point.second + width,
    requests: point.requests,
    failures: point.failures,
    requestsPerSecond: round2(point.requests / width),
    failuresPerSecond: round2(point.failures / width),
  }));
  const totals = points.reduce((sum, point) => ({ requests: sum.requests + point.requests, failures: sum.failures + point.failures }), { requests: 0, failures: 0 });
  if (points.length === 0 || totals.requests === 0) return null;
  const peak = Math.max(...points.map((point) => point.requestsPerSecond));
  const axisMax = niceCeil(Math.max(1, peak));
  const half = axisMax / 2;
  const yValues = Number.isInteger(half) ? [0, half, axisMax] : [0, axisMax];
  const totalSeconds = points.length * width;
  const tick = timeTickMs(totalSeconds * 1000) / 1000;
  const xTicks: SeriesChart["xTicks"] = [];
  for (let second = 0; second <= totalSeconds; second += tick) xTicks.push({ second, label: clock(second * 1000) });
  const failingSteps = points.filter((point) => point.failures > 0).length;
  const unit = width === 1 ? "second" : `${width}-second step`;
  const plural = points.length === 1 ? unit : `${unit}s`;
  return {
    bucketSeconds: width,
    totalSeconds,
    points,
    axisMax,
    yTicks: yValues.map((value) => ({ value, label: formatCount(value) })),
    xTicks,
    totals,
    peak,
    failingSteps,
    summary: `Requests and failed requests per second over ${clock(totalSeconds * 1000)}; ${formatCount(totals.requests)} requests, ${formatCount(totals.failures)} failed; peak ${formatCount(peak)} requests per second; ${formatCount(failingSteps)} of ${formatCount(points.length)} ${plural} had failures.`,
    note:
      width === 1
        ? "One point per second; a request counts in the second it finished. Virtual users do not apply: requests run one after another."
        : `One point per ${formatCount(width)}-second step: points are merged into wider steps of ${formatCount(width)} seconds to keep the graph readable, and each plotted rate is the requests in a step divided by ${formatCount(width)}.`,
  };
}

export interface ChartBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Pt = readonly [number, number];

export interface SeriesChartLayout {
  requestsLine: Pt[];
  failuresLine: Pt[];
  /** Where a step had failures: a square marker, so failures show without colour. */
  failureMarkers: Pt[];
  yMarks: { y: number; label: string }[];
  xMarks: { x: number; label: string }[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Places the chart's figures in `box` (points from the top left). Each point sits in the middle of its step. */
export function layoutSeriesChart(chart: SeriesChart, box: ChartBox): SeriesChartLayout {
  const column = box.w / chart.points.length;
  const yOf = (rate: number) => round1(box.y + box.h - (box.h * rate) / chart.axisMax);
  const xOf = (index: number) => round1(box.x + (index + 0.5) * column);
  const requestsLine = chart.points.map((point, index): Pt => [xOf(index), yOf(point.requestsPerSecond)]);
  const failuresLine = chart.points.map((point, index): Pt => [xOf(index), yOf(point.failuresPerSecond)]);
  return {
    requestsLine,
    failuresLine,
    failureMarkers: failuresLine.filter((_, index) => chart.points[index].failures > 0),
    yMarks: chart.yTicks.map((tick) => ({ y: yOf(tick.value), label: tick.label })),
    xMarks: chart.xTicks.map((tick) => ({ x: round1(box.x + (box.w * tick.second) / chart.totalSeconds), label: tick.label })),
  };
}

export const NO_REQUESTS_NOTE = "No requests were sent in this run, so there is no per-second graph.";
