import type { EnvironmentTier, K6Readiness, LoadProfile, LoadStage, PerformanceRunSummary } from "@apipilot/shared-domain";
import type { StatusTone } from "../StatusBadge";

/**
 * Display labels and tones for performance runs and environments (AP-029, AP-034, AP-037), kept out of
 * JSX (CLAUDE.md §43). Every tone is paired with a text label; colour is never the only signal.
 */
export const TIER_TONE: Record<EnvironmentTier, StatusTone> = {
  local: "neutral",
  dev: "neutral",
  qa: "info",
  staging: "warning",
  production: "danger",
};

export const READINESS_REASON: Record<Extract<K6Readiness, { state: "unavailable" }>["reason"], string> = {
  "not-found": "k6 was not found. Install k6 1.0.0 or later on this machine, or set K6_BINARY_PATH. ApiPilot never downloads or installs k6.",
  "not-executable": "k6 was found but could not be started.",
  "version-unreadable": "k6 was found but its version could not be read.",
  "unsupported-version": "k6 is installed but not supported.",
};

export function runStatusLabel(run: Pick<PerformanceRunSummary, "status" | "cancelReason" | "failure">): { label: string; tone: StatusTone } {
  if (run.status === "in-progress") return { label: "In progress", tone: "info" };
  if (run.status === "completed") return { label: "Completed", tone: "success" };
  if (run.status === "failed") return { label: `Failed · ${run.failure?.category ?? "unknown"}`, tone: "danger" };
  return run.cancelReason === "backend-restart"
    ? { label: "Cancelled · backend restart", tone: "warning" }
    : { label: "Cancelled · by you", tone: "neutral" };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The run-setup line for a load profile, e.g. "Smoke · 1 stage · 01:00 · peak 1 VU". */
export function loadProfileSummary(profile: LoadProfile): string {
  const stages = profile.stages.length;
  const peak = Math.max(0, ...profile.stages.map((stage) => stage.targetVirtualUsers));
  const kind = profile.kind.charAt(0).toUpperCase() + profile.kind.slice(1);
  return `${kind} · ${stages} stage${stages === 1 ? "" : "s"} · ${formatDuration(profile.plannedDurationMs)} · peak ${peak} VU${peak === 1 ? "" : "s"}`;
}

/** Stage durations are edited in whole seconds and sent as milliseconds. */
export function secondsToMs(seconds: number): number {
  return Math.max(1, Math.round(seconds)) * 1000;
}

/** k6 starts a run that has only `stages` at one virtual user, then ramps linearly to each stage's target. */
export const K6_STARTING_VIRTUAL_USERS = 1;

export interface LoadProfilePoint {
  seconds: number;
  virtualUsers: number;
}

/**
 * The planned virtual users over time as the corners of the ramp k6 follows: the starting point, then the
 * end of each stage at its target. Pure, so the chart's geometry is testable without rendering.
 */
export function loadProfilePoints(stages: readonly Pick<LoadStage, "durationMs" | "targetVirtualUsers">[]): LoadProfilePoint[] {
  let seconds = 0;
  const points: LoadProfilePoint[] = [{ seconds, virtualUsers: K6_STARTING_VIRTUAL_USERS }];
  for (const stage of stages) {
    seconds += stage.durationMs / 1000;
    points.push({ seconds, virtualUsers: stage.targetVirtualUsers });
  }
  return points;
}
