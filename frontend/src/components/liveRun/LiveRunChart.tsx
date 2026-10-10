import { useMemo, useState, type PointerEvent } from "react";
import type { LivePoint, LiveSeries } from "@apipilot/shared-domain";
import { axisTicks, formatAxisTime, formatTick, timeSpan, timeTicks } from "./chartScale";
import { formatRate, formatRequestDuration, hasVirtualUsers, perSecond } from "./liveRunViewModel";

const WIDTH = 760;
const PAD_TOP = 14;
const PAD_BOTTOM = 40;
const PAD_LEFT = 62;
const PAD_RIGHT = 62;
const RATE_HEIGHT = 280;
const LATENCY_HEIGHT = 170;

/** Full class names, so Tailwind sees every one of them. */
const STROKE = {
  requests: "stroke-chart-1",
  failures: "stroke-chart-5",
  users: "stroke-chart-3",
  latency: "stroke-chart-6",
  groups: ["stroke-chart-1", "stroke-chart-2", "stroke-chart-4", "stroke-chart-6"],
} as const;
const FILL = {
  requests: "fill-chart-1",
  failures: "fill-chart-5",
  users: "fill-chart-3",
  latency: "fill-chart-6",
  groups: ["fill-chart-1", "fill-chart-2", "fill-chart-4", "fill-chart-6"],
} as const;
/** A group after the fourth reuses a colour with a dash, so every line in the legend differs by more than colour. */
const GROUP_DASH = [undefined, undefined, undefined, undefined, "8 3", "8 3", "8 3", "8 3"] as const;

interface Line {
  id: string;
  label: string;
  stroke: string;
  fill: string;
  dash: string | undefined;
  width: number;
  axis: "left" | "right";
  values: (number | null)[];
}

interface PlotSpec {
  height: number;
  leftLabel: string;
  rightLabel?: string;
  leftTicks: number[];
  rightTicks?: number[];
  formatLeft: (value: number) => string;
  formatRight?: (value: number) => string;
  lines: Line[];
  /** Index of the line that carries the "latest" marker. */
  markerLine: number;
}

function pathOf(line: Line, points: readonly LivePoint[], x: (second: number) => number, y: (value: number) => number): string {
  let path = "";
  let pen = false;
  points.forEach((point, index) => {
    const value = line.values[index];
    if (value === null || value === undefined) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(point.second).toFixed(1)} ${y(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}

/** One graph: gridlines and tick values on the left (and optionally right) axis, a time axis, the lines, and a hover rule. */
function LinePlot({
  spec,
  points,
  span,
  hover,
  onHover,
  testId,
  label,
}: Readonly<{ spec: PlotSpec; points: readonly LivePoint[]; span: number; hover: number | null; onHover: (index: number | null) => void; testId: string; label: string }>) {
  // Both plots reserve the right axis, so a point is at the same x in each and the hover rule lines up.
  const padRight = PAD_RIGHT;
  const plotWidth = WIDTH - PAD_LEFT - padRight;
  const plotHeight = spec.height - PAD_TOP - PAD_BOTTOM;
  const leftMax = spec.leftTicks[spec.leftTicks.length - 1] ?? 1;
  const rightMax = spec.rightTicks?.[spec.rightTicks.length - 1] ?? 1;
  const x = (second: number) => PAD_LEFT + (second / span) * plotWidth;
  const yFor = (axis: "left" | "right") => (value: number) => PAD_TOP + plotHeight - (value / (axis === "left" ? leftMax : rightMax)) * plotHeight;
  const xTicks = timeTicks(span);
  const marker = spec.lines[spec.markerLine];
  const lastIndex = points.length - 1;

  function handlePointer(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = (event.clientX - rect.left) / rect.width;
    const second = fraction * span;
    const first = points[0]?.second ?? 0;
    const width = points.length > 1 ? (points[1]!.second - first) : 1;
    onHover(Math.min(lastIndex, Math.max(0, Math.round((second - first) / Math.max(1, width)))));
  }

  return (
    <svg viewBox={`0 0 ${WIDTH} ${spec.height}`} role="img" aria-label={label} className="block h-auto w-full min-w-150" data-testid={testId}>
      {spec.leftTicks.map((tick) => {
        const y = yFor("left")(tick);
        return (
          <g key={`l${tick}`}>
            <line x1={PAD_LEFT} x2={WIDTH - padRight} y1={y} y2={y} className={tick === 0 ? "stroke-border-strong" : "stroke-border"} strokeWidth={1} data-gridline="" />
            <text x={PAD_LEFT - 8} y={y + 3.5} textAnchor="end" fontSize={11} className="fill-muted font-mono" data-axis="left">
              {spec.formatLeft(tick)}
            </text>
          </g>
        );
      })}
      {spec.rightTicks?.map((tick) => (
        <text key={`r${tick}`} x={WIDTH - padRight + 8} y={yFor("right")(tick) + 3.5} fontSize={11} className={`${FILL.users} font-mono`} data-axis="right">
          {spec.formatRight ? spec.formatRight(tick) : tick}
        </text>
      ))}
      <text transform={`translate(14 ${PAD_TOP + plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} className="fill-muted" data-axis-title="left">
        {spec.leftLabel}
      </text>
      {spec.rightLabel && (
        <text transform={`translate(${WIDTH - 12} ${PAD_TOP + plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} className={FILL.users} data-axis-title="right">
          {spec.rightLabel}
        </text>
      )}
      {xTicks.map((second) => (
        <g key={`x${second}`}>
          <line x1={x(second)} x2={x(second)} y1={PAD_TOP + plotHeight} y2={PAD_TOP + plotHeight + 4} className="stroke-border-strong" strokeWidth={1} />
          <text x={x(second)} y={spec.height - 18} textAnchor="middle" fontSize={11} className="fill-muted font-mono" data-axis="time">
            {formatAxisTime(second)}
          </text>
        </g>
      ))}
      <text x={PAD_LEFT + plotWidth / 2} y={spec.height - 1} textAnchor="middle" fontSize={10} className="fill-muted">
        Elapsed time (m:ss)
      </text>
      {spec.lines.map((line) => (
        <path
          key={line.id}
          data-series={line.id}
          d={pathOf(line, points, x, yFor(line.axis))}
          fill="none"
          strokeWidth={line.width}
          strokeDasharray={line.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={line.stroke}
        />
      ))}
      {marker && lastIndex >= 0 && marker.values[lastIndex] !== null && marker.values[lastIndex] !== undefined && (
        <circle cx={x(points[lastIndex]!.second)} cy={yFor(marker.axis)(marker.values[lastIndex]!)} r={3.5} className={marker.fill} data-latest="" />
      )}
      {hover !== null && points[hover] && (
        <g data-hover="">
          <line x1={x(points[hover]!.second)} x2={x(points[hover]!.second)} y1={PAD_TOP} y2={PAD_TOP + plotHeight} className="stroke-text-secondary" strokeWidth={1} strokeDasharray="3 3" />
          {spec.lines.map((line) => {
            const value = line.values[hover];
            return value === null || value === undefined ? null : <circle key={line.id} cx={x(points[hover]!.second)} cy={yFor(line.axis)(value)} r={3} className={line.fill} />;
          })}
        </g>
      )}
      <rect x={PAD_LEFT} y={PAD_TOP} width={plotWidth} height={plotHeight} fill="transparent" onPointerMove={handlePointer} onPointerLeave={() => onHover(null)} data-testid={`${testId}-hit`} />
    </svg>
  );
}

function Swatch({ stroke, dash, width = 2.5 }: Readonly<{ stroke: string; dash: string | undefined; width?: number }>) {
  return (
    <svg width="30" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" x2="29" y1="4" y2="4" strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" className={stroke} />
    </svg>
  );
}

type View = "total" | "groups";

/**
 * The run over time (AP-045 FR-002, FR-003, FR-012): requests per second (in total, or one line per
 * chain), failures per second and virtual users, with a labelled axis on each side, gridlines and a
 * time axis that spans the planned run; and the average response time beneath. Inline SVG following
 * `LoadProfileChart`, tokens only. Series differ by line style and are named in a legend, so colour is
 * never the only cue; hovering reads off any second; the same figures are in a table. Nothing animates.
 */
export function LiveRunChart({ series, thinned, plannedSeconds = null }: Readonly<{ series: LiveSeries; thinned: boolean; plannedSeconds?: number | null }>) {
  const { points, bucketSeconds } = series;
  const groups = series.groups && points.some((point) => point.byGroup) ? series.groups : undefined;
  const [view, setView] = useState<View>("total");
  const [hover, setHover] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const mode: View = groups ? view : "total";

  const model = useMemo(() => {
    if (points.length === 0) return null;
    const requests = points.map((point) => perSecond(point.requests, bucketSeconds));
    const failures = points.map((point) => perSecond(point.failures, bucketSeconds));
    const users = points.map((point) => point.virtualUsers);
    const latency = points.map((point) => point.latencyMs ?? null);
    const showUsers = hasVirtualUsers(points);
    const showLatency = latency.some((value) => value !== null);
    const groupLines: Line[] = (groups ?? []).map((group, index) => ({
      id: `group-${group.id}`,
      label: group.label,
      stroke: STROKE.groups[index % STROKE.groups.length]!,
      fill: FILL.groups[index % FILL.groups.length]!,
      dash: GROUP_DASH[index % GROUP_DASH.length],
      width: 2.25,
      axis: "left",
      values: points.map((point) => perSecond(point.byGroup?.[group.id] ?? 0, bucketSeconds)),
    }));
    const rateLines: Line[] =
      mode === "groups" && groupLines.length > 0
        ? groupLines
        : [{ id: "requests", label: "Requests/s", stroke: STROKE.requests, fill: FILL.requests, dash: undefined, width: 2.5, axis: "left", values: requests }];
    const failureLine: Line = { id: "failures", label: "Failures/s", stroke: STROKE.failures, fill: FILL.failures, dash: "6 4", width: 2, axis: "left", values: failures };
    const userLine: Line = { id: "virtual-users", label: "Virtual users", stroke: STROKE.users, fill: FILL.users, dash: "1 4", width: 2.5, axis: "right", values: users };
    const peakRate = Math.max(1, ...rateLines.flatMap((line) => line.values.map((value) => value ?? 0)), ...failures);
    const peakUsers = Math.max(1, ...users.map((value) => value ?? 0));
    const peakLatency = Math.max(1, ...latency.map((value) => value ?? 0));
    const last = points[points.length - 1]!;
    return {
      requests,
      failures,
      users,
      latency,
      showUsers,
      showLatency,
      rateLines,
      failureLine,
      userLine,
      leftTicks: axisTicks(peakRate, { integer: true }),
      rightTicks: axisTicks(peakUsers, { integer: true }),
      latencyTicks: axisTicks(peakLatency),
      span: timeSpan(last.second, bucketSeconds, plannedSeconds),
    };
  }, [points, bucketSeconds, groups, mode, plannedSeconds]);

  if (!model) {
    return (
      <figure className="space-y-1" data-testid="live-run-chart">
        <figcaption className="text-xs font-medium text-muted">Requests per second, failures per second and virtual users</figcaption>
        <p className="rounded-md border border-dashed border-border bg-surface-subtle px-3 py-6 text-center text-sm text-muted">Waiting for the first figures</p>
      </figure>
    );
  }

  const shown = hover !== null && points[hover] ? hover : points.length - 1;
  const point = points[shown]!;
  const readout = [
    `At ${formatAxisTime(point.second)}`,
    `${formatRate(model.requests[shown]!)} requests/s`,
    `${formatRate(model.failures[shown]!)} failures/s`,
    ...(model.showUsers ? [`${point.virtualUsers ?? "no"} virtual users`] : []),
    ...(model.showLatency ? [point.latencyMs === null || point.latencyMs === undefined ? "no response time yet" : `${formatRequestDuration(point.latencyMs)} average response time`] : []),
    ...(mode === "groups" && groups ? groups.map((group) => `${group.label} ${formatRate(perSecond(point.byGroup?.[group.id] ?? 0, bucketSeconds))}/s`) : []),
  ].join(" · ");
  const latest = points.length - 1;
  const summary =
    `Requests per second, failures per second${model.showUsers ? " and virtual users" : ""} over ${formatAxisTime(points[latest]!.second)}. ` +
    `Latest: ${formatRate(model.requests[latest]!)} requests per second, ${formatRate(model.failures[latest]!)} failures per second` +
    `${model.showUsers ? `, ${points[latest]!.virtualUsers ?? "no"} virtual users` : ""}. The values are also in the table below the graph.`;

  const ratePlot: PlotSpec = {
    height: RATE_HEIGHT,
    leftLabel: "Requests per second",
    ...(model.showUsers ? { rightLabel: "Virtual users", rightTicks: model.rightTicks, formatRight: formatTick } : {}),
    leftTicks: model.leftTicks,
    formatLeft: formatTick,
    lines: [...model.rateLines, model.failureLine, ...(model.showUsers ? [model.userLine] : [])],
    markerLine: 0,
  };
  const latencyPlot: PlotSpec = {
    height: LATENCY_HEIGHT,
    leftLabel: "Average response time (ms)",
    leftTicks: model.latencyTicks,
    formatLeft: formatTick,
    lines: [{ id: "latency", label: "Average response time", stroke: STROKE.latency, fill: FILL.latency, dash: undefined, width: 2.5, axis: "left", values: model.latency }],
    markerLine: 0,
  };

  return (
    <figure className="space-y-3" data-testid="live-run-chart">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">
          Requests, failures{model.showUsers ? " and virtual users" : ""} over time
          {bucketSeconds > 1 && ` · one point per ${bucketSeconds} seconds`}
        </span>
        {groups && (
          <span role="group" aria-label="Requests view" className="inline-flex overflow-hidden rounded-md border border-border text-xs">
            {(["total", "groups"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setView(option)}
                className={`px-2.5 py-1 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${mode === option ? "bg-brand-600 text-white" : "bg-surface text-text-secondary hover:bg-surface-hover"}`}
              >
                {option === "total" ? "Total" : "By chain"}
              </button>
            ))}
          </span>
        )}
      </figcaption>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="live-run-legend" aria-label="Lines">
        {ratePlot.lines.map((line) => (
          <li key={line.id} className="inline-flex items-center gap-1.5" data-legend={line.id}>
            <Swatch stroke={line.stroke} dash={line.dash} width={line.width} />
            <span>{line.label}</span>
          </li>
        ))}
      </ul>

      <p className="min-h-5 text-xs text-text-secondary" data-testid="live-run-readout" aria-live="off">
        {readout}
      </p>

      <div className="max-w-full overflow-x-auto" data-testid="live-run-plots">
        <LinePlot spec={ratePlot} points={points} span={model.span} hover={hover} onHover={setHover} testId="live-run-chart-svg" label={summary} />
        {model.showLatency && (
          <div className="mt-3 space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <Swatch stroke={STROKE.latency} dash={undefined} /> Average response time
            </p>
            <LinePlot spec={latencyPlot} points={points} span={model.span} hover={hover} onHover={setHover} testId="live-run-latency-svg" label="Average response time per second, in milliseconds. The values are also in the table below the graph." />
          </div>
        )}
      </div>

      <p className="text-xs text-muted">
        Solid line{groups && mode === "groups" ? "s" : ""}: requests per second{groups && mode === "groups" ? ", one per chain" : ""}. Dashed line: failures per second.
        {model.showUsers && " Dotted line: virtual users (right axis)."}
      </p>
      {thinned && (
        <p className="text-xs text-muted" data-testid="live-run-thinned">
          Thinned: older seconds are merged into wider steps of {bucketSeconds} seconds to keep the graph fast. The totals are unchanged.
        </p>
      )}

      <details onToggle={(event) => setTableOpen(event.currentTarget.open)} className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">Values as a table</summary>
        {tableOpen && (
          <div className="mt-2 max-h-64 max-w-full overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Requests, failures, virtual users and response time for each {bucketSeconds === 1 ? "second" : `${bucketSeconds}-second step`} of the run</caption>
              <thead className="sticky top-0 bg-chrome text-muted">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Time</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Requests</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Failures</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Requests/s</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Failures/s</th>
                  {model.showUsers && <th scope="col" className="px-3 py-1.5 font-semibold">Virtual users</th>}
                  {model.showLatency && <th scope="col" className="px-3 py-1.5 font-semibold">Avg response</th>}
                  {groups?.map((group) => (
                    <th key={group.id} scope="col" className="px-3 py-1.5 font-semibold">
                      {group.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {points.map((row, index) => (
                  <tr key={row.second}>
                    <th scope="row" className="px-3 py-1 font-normal">{formatAxisTime(row.second)}</th>
                    <td className="px-3 py-1">{row.requests}</td>
                    <td className="px-3 py-1">{row.failures}</td>
                    <td className="px-3 py-1">{formatRate(model.requests[index]!)}</td>
                    <td className="px-3 py-1">{formatRate(model.failures[index]!)}</td>
                    {model.showUsers && <td className="px-3 py-1">{row.virtualUsers ?? "—"}</td>}
                    {model.showLatency && <td className="px-3 py-1">{row.latencyMs === null || row.latencyMs === undefined ? "—" : formatRequestDuration(row.latencyMs)}</td>}
                    {groups?.map((group) => (
                      <td key={group.id} className="px-3 py-1">{row.byGroup?.[group.id] ?? 0}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </figure>
  );
}
