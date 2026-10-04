import type { LoadStage } from "@apipilot/shared-domain";
import { formatDuration, loadProfilePoints } from "./performanceViewModel";

const WIDTH = 400;
const HEIGHT = 150;
const PAD = { left: 34, right: 10, top: 10, bottom: 24 };

/**
 * The planned virtual users over time. It draws exactly the stages the engineer entered, as k6
 * will ramp them, and implies no recommended target. The figure is described in words for assistive
 * technology, so the numbers are never only in the picture.
 */
export function LoadProfileChart({ stages }: Readonly<{ stages: readonly Pick<LoadStage, "durationMs" | "targetVirtualUsers">[] }>) {
  const points = loadProfilePoints(stages);
  const totalSeconds = points[points.length - 1].seconds;
  if (stages.length === 0 || totalSeconds <= 0) return null;
  const peak = Math.max(1, ...points.map((point) => point.virtualUsers));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (seconds: number) => PAD.left + (seconds / totalSeconds) * plotWidth;
  const y = (virtualUsers: number) => PAD.top + plotHeight - (virtualUsers / peak) * plotHeight;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.seconds).toFixed(1)} ${y(point.virtualUsers).toFixed(1)}`).join(" ");
  const area = `${line} L${x(totalSeconds).toFixed(1)} ${y(0)} L${x(0)} ${y(0)} Z`;
  const yTicks = [...new Set([0, Math.round(peak / 2), peak])];
  const xTicks = [0, totalSeconds / 2, totalSeconds];

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-medium text-muted">Planned virtual users over time</figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Planned virtual users over ${formatDuration(totalSeconds * 1000)}: ${stages.length} ${stages.length === 1 ? "stage" : "stages"}, peaking at ${peak}.`}
        className="block w-full"
        data-testid="load-profile-chart"
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} className="fill-muted font-mono">
              {tick}
            </text>
          </g>
        ))}
        <path d={area} className="fill-brand-500/15" />
        <path d={line} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="stroke-brand-600 dark:stroke-brand-300" />
        {points.slice(1).map((point) => (
          <circle key={point.seconds} cx={x(point.seconds)} cy={y(point.virtualUsers)} r={3} className="fill-brand-600 dark:fill-brand-300" />
        ))}
        {xTicks.map((tick, index) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 6} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"} fontSize={10} className="fill-muted font-mono">
            {formatDuration(tick * 1000)}
          </text>
        ))}
      </svg>
    </figure>
  );
}
