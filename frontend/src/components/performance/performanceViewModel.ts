import type {
  EnvironmentTier,
  K6Readiness,
  LoadProfile,
  PerformanceJourney,
  PerformanceResult,
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

/** `null` when the choice needs no explanation: an operation's only positive scenario is simply used. */
export const SCENARIO_CHOICE_LABEL: Record<PerformanceStep["scenarioChoice"], string | null> = {
  "rule-generated": "Rule-generated",
  "only-positive": null,
  "ai-enhanced-no-rule-alternative": "AI-enhanced (no rule-generated alternative)",
};

/** Why this scenario was chosen, or `null` when there is nothing to explain. */
export function choiceNote(step: Pick<PerformanceStep, "scenarioChoice" | "tieBrokenByLowestId">): string | null {
  const parts = [SCENARIO_CHOICE_LABEL[step.scenarioChoice], step.tieBrokenByLowestId ? "lowest id among equals" : null];
  const note = parts.filter((part): part is string => part !== null).join(" · ");
  return note.length > 0 ? note : null;
}

export const AUTH_LABEL: Record<StepAuthKind, string> = {
  "oauth2-client-credentials": "OAuth2 client credentials",
  "chained-login": "Token from a login request",
  "static-credential": "Credential from the environment",
  none: "No authentication",
};

/** The environment values a step needs, other than the base URL every step needs. */
export function environmentValuesOf(step: Pick<PerformanceStep, "requiredValues">): string[] {
  return step.requiredValues.filter((name) => name !== "baseUrl");
}

/** A step's variables in words: what it produces or consumes, and the values it needs. */
export function variablesFor(step: Pick<PerformanceStep, "variableBindings" | "requiredValues">): string[] {
  return [
    ...step.variableBindings.map((binding) => `${binding.role} ${binding.variable}`),
    ...environmentValuesOf(step).map((name) => `needs ${name}`),
  ];
}

/** The table's one-line form of AUTH_LABEL; the full label is shown in the step's details. */
export const AUTH_SHORT_LABEL: Record<StepAuthKind, string> = {
  "oauth2-client-credentials": "OAuth2 client",
  "chained-login": "Login token",
  "static-credential": "Env credential",
  none: "None",
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

/** AP-032 FR-003a, FR-024: why an operation is in the removed list. Derived, never stored. */
export function removalReason(operationKey: string, credentialProducerOperationKeys: readonly string[]): string | undefined {
  // An operation you removed yourself needs no label: the list's heading already says "removed".
  return credentialProducerOperationKeys.includes(operationKey) ? "used to acquire the run's credentials" : undefined;
}

/** AP-032 FR-024: why an operation contributes no step. */
export const OMITTED_REASON_LABEL: Record<"no-positive-scenario", string> = {
  "no-positive-scenario": "No positive scenario",
};

/** Groups digits with commas, independent of the browser's locale, as the report does. */
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * AP-033 FR-023 (amended 2026-09-30): per step id, the statuses a finished run received that the
 * step does not expect, as text ("400 × 7,422"; "no response" for status 0). A run recorded before
 * every status was kept lists its failure statuses, which are the same responses.
 */
export function unexpectedStatusesByStep(result: PerformanceResult | undefined): Map<string, string> {
  const byStep = new Map<string, string>();
  for (const step of result?.steps ?? []) {
    const unexpected = step.statusesReceived ? step.statusesReceived.filter((entry) => !entry.expected) : step.errorsByStatus;
    if (unexpected.length === 0) continue;
    byStep.set(step.stepId, unexpected.map((entry) => `${entry.status === "0" ? "no response" : entry.status} × ${groupDigits(entry.count)}`).join(", "));
  }
  return byStep;
}

/**
 * AP-035 FR-022 (specs/035-user-defined-journeys research R16): how a journey's origin is shown,
 * always as text. A proposed journey came from an approved workflow; a user-defined one is the
 * engineer's, or based on a workflow they edited.
 */
export function journeyOriginLabel(source: PerformanceJourney["source"]): string {
  if (source.kind === "workflow") return "Proposed from workflow";
  if (source.kind === "user") return source.basedOnWorkflowId ? "Based on workflow" : "Defined by you";
  return "Single operation";
}

export const INCOMPLETE_LABEL = "Incomplete";
export const TARGET_MISSING_LABEL = "Target no longer exists";
export const NOT_DOCUMENTED_LABEL = "Not documented in the specification";
export const USES_CAPTURE_LABEL = "Uses captured value";

export function capturesLabel(count: number): string {
  return `Captures ${count}`;
}
