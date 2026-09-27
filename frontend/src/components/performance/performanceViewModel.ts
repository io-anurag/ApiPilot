import type {
  EnvironmentTier,
  K6Readiness,
  PerformanceRunSummary,
  PerformanceStep,
  StepAuthKind,
} from "@apipilot/shared-domain";
import type { StatusTone } from "../StatusBadge";

/**
 * Display labels and tones for the performance stage (AP-029), kept out of JSX (CLAUDE.md §43).
 * Every tone is paired with a text label; colour is never the only signal.
 */
export const TIER_TONE: Record<EnvironmentTier, StatusTone> = {
  local: "neutral",
  dev: "neutral",
  qa: "info",
  staging: "warning",
  production: "danger",
};

export const SCENARIO_CHOICE_LABEL: Record<PerformanceStep["scenarioChoice"], string> = {
  "rule-generated": "Rule-generated",
  "only-positive": "Only positive scenario",
  "ai-enhanced-no-rule-alternative": "AI-enhanced (no rule-generated alternative)",
};

export const AUTH_LABEL: Record<StepAuthKind, string> = {
  "oauth2-client-credentials": "OAuth2 client credentials",
  "chained-login": "Token from a login request",
  "static-credential": "Credential from the environment",
  none: "No authentication",
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

/** Stage durations are edited in whole seconds and sent as milliseconds. */
export function secondsToMs(seconds: number): number {
  return Math.max(1, Math.round(seconds)) * 1000;
}
