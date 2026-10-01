import type {
  LatencyPercentiles,
  LatencySummary,
  LoadProfile,
  PerformanceRunCancelReason,
  PerformanceRunEnvironment,
  PerformanceRunFailureCategory,
  PerformanceRunStatus,
  PerformanceThresholdMetric,
  RequestPhaseTiming,
  StepTimelinePoint,
  TimelinePoint,
  WriteMethod,
} from "./performance";

/**
 * AP-034 (specs/034-run-user-k6-script data-model.md): a k6 script the engineer supplied, its
 * check, confirmation, run settings, runs and results. Framework-agnostic, like every type in this
 * package. None of these types carries the script's content or any environment value.
 */

/** FR-002: at most 1 MiB of UTF-8 text. */
export const USER_SCRIPT_MAX_BYTES = 1_048_576;

/** FR-026 + research R11: why a name cannot be mapped. */
export type MappingNameRefusal = "invalid-characters" | "starts-with-digit" | "k6-prefix" | "reserved-startup-name";

export type UserScriptValueSource = { kind: "base-url" } | { kind: "environment-value"; valueName: string };

export interface ScriptEnvName {
  name: string;
  mappable: boolean;
  reason?: MappingNameRefusal;
  /** From a `const` literal table's key (research R5), for example a generated script's `VALUE_ENV`. */
  suggestedSource?: UserScriptValueSource;
}

export type ScriptRuleId =
  | "parse-error"
  | "not-utf8-text"
  | "too-large"
  | "import-remote"
  | "import-file"
  | "import-extension"
  | "import-experimental"
  | "import-forbidden-builtin"
  | "import-not-allowed"
  | "dynamic-import"
  | "import-meta"
  | "forbidden-identifier"
  | "forbidden-property"
  | "computed-access"
  | "timer-string-code"
  | "handle-summary";

/** One reason a script is refused (FR-004). `line` and `column` are 1-based. */
export interface ScriptProblem {
  rule: ScriptRuleId;
  line: number;
  column: number;
  message: string;
}

export interface ScriptCheckAccepted {
  accepted: true;
  /** `scheme://host:port`, sorted, unique (FR-009, research R4). */
  hosts: string[];
  /** Sorted, unique (FR-009, research R5). */
  envNames: ScriptEnvName[];
  /** FR-027: a load profile override needs a default function. */
  hasDefaultFunction: boolean;
}

export interface ScriptCheckRefused {
  accepted: false;
  /** Sorted by line, column, then rule id (FR-008). */
  problems: ScriptProblem[];
}

export type ScriptCheckResult = ScriptCheckAccepted | ScriptCheckRefused;

/** FR-013 to FR-016: the engineer's acceptance of one script's exact bytes. */
export interface ScriptConfirmation {
  sha256: string;
  confirmedAt: string;
  hostsStated: string[];
}

export interface UserScriptValueMapping {
  name: string;
  source: UserScriptValueSource;
  /** Derived on read: whether the current check still finds this name. */
  foundInScript: boolean;
}

export type UserScriptLoad = { kind: "script" } | { kind: "profile"; profile: LoadProfile };

export type UserScriptThresholdScope = { kind: "run" } | { kind: "request-name"; name: string };

/** A user-set pass/fail limit (FR-028, research R15). Latency limits in ms, error rate in percent. */
export interface UserScriptThreshold {
  /** Content-derived. */
  id: string;
  scope: UserScriptThresholdScope;
  metric: PerformanceThresholdMetric;
  comparator: "<=";
  limit: number;
}

/** Kept with the script; changing it never changes the bytes or the confirmation (FR-028). */
export interface UserScriptRunSettings {
  /** Sorted by name. */
  mapping: UserScriptValueMapping[];
  /** Found names the engineer removed, so a content change does not add them back (research R12). */
  removedNames: string[];
  load: UserScriptLoad;
  thresholds: UserScriptThreshold[];
}

export const USER_SCRIPT_MAX_MAPPINGS = 100;
export const USER_SCRIPT_MAX_THRESHOLDS = 50;

export interface UserScriptLastRun {
  runId: string;
  status: PerformanceRunStatus;
  startedAt: string;
}

/** A row of the script list (FR-003). */
export interface UserScriptSummary {
  id: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  /** `confirmation.sha256 === sha256`. */
  confirmed: boolean;
  lastRun: UserScriptLastRun | null;
  updatedAt: string;
}

export interface UserScript extends UserScriptSummary {
  /** Recomputed from the content with the current rules (research R7, R17). */
  check: ScriptCheckResult;
  /** Null unless it matches the current SHA-256. */
  confirmation: ScriptConfirmation | null;
  settings: UserScriptRunSettings;
}

/** `GET /:id/values`: whether the chosen environment has each mapped value. Never the value. */
export interface MappedValueStatus {
  name: string;
  source: UserScriptValueSource;
  present: boolean;
}

/** Research R13: what k6's exit code means. */
export type K6ExitMeaning =
  | "completed"
  | "script-thresholds-crossed"
  | "aborted-by-script"
  | "marked-failed-by-script"
  | "invalid-config"
  | "script-exception"
  | "other";

/** What a run recorded about its script and configuration (FR-030). Never content or values. */
export interface UserScriptRunSnapshot {
  scriptId: string;
  scriptName: string;
  /** Equals the SHA-256 of the executed bytes (SC-003). */
  scriptSha256: string;
  load: UserScriptLoad;
  mapping: { name: string; source: UserScriptValueSource }[];
  thresholds: UserScriptThreshold[];
  hostsFound: string[];
}

export interface UserScriptRunProgress {
  elapsedMs: number;
  currentVirtualUsers: number;
  requestsSoFar: number;
  failuresSoFar: number;
}

export interface RequestGroupMetrics {
  requests: number;
  /** k6's own count: `http_req_failed = 1`. */
  failures: number;
  failureRatePercent: number;
  throughputPerSecond: number;
  latencyMs: LatencyPercentiles | null;
  latencySummaryMs: LatencySummary | null;
  /** Status 0 means no response. */
  statusesReceived: { status: number; count: number }[];
  phaseTimings: RequestPhaseTiming[];
}

export interface RequestGroupResult extends RequestGroupMetrics {
  /** Research R14's display-name rule; never a raw URL. */
  displayName: string;
  /** False when shown as `METHOD host/path`. */
  named: boolean;
  writes: { method: WriteMethod; sent: number; succeeded: number }[];
  timeline: StepTimelinePoint[];
}

export type CustomMetricSummary =
  | { name: string; type: "counter"; total: number; ratePerSecond: number }
  | { name: string; type: "gauge"; last: number; min: number; max: number }
  | { name: string; type: "rate"; percentTrue: number; samples: number }
  | { name: string; type: "trend"; percentiles: LatencyPercentiles; summary: LatencySummary };

export type UserScriptFindingRuleId =
  | "apipilot-threshold-failed"
  | "script-thresholds-crossed"
  | "slowest-request"
  | "failures-start"
  | "most-frequent-failing-status"
  | "names-combined"
  | "hosts-outside-environment"
  | "script-ended-run";

export interface UserScriptFinding {
  ruleId: UserScriptFindingRuleId;
  subjects: string[];
  message: string;
  values: Record<string, number | string>;
}

export const USER_SCRIPT_FINDINGS_RULESET_VERSION = 1;

/** Per research R14: at most this many named groups, then one "Other requests" group. */
export const USER_SCRIPT_MAX_REQUEST_GROUPS = 100;

export interface UserScriptResult {
  totals: RequestGroupMetrics & {
    iterations: number;
    iterationDurationMs: (LatencyPercentiles & LatencySummary) | null;
    dataSentBytes: number;
    dataReceivedBytes: number;
  };
  /** At most 100, in first-appearance order. */
  requestGroups: RequestGroupResult[];
  otherRequests: (RequestGroupResult & { combinedNames: number }) | null;
  /**
   * At most 50, sorted by origin. `source: "url"` is `scheme://host:port` from an unnamed request's
   * URL. k6 replaces a named request's `url` tag with its name, so a named request is counted by
   * the server address k6 connected to (`source: "ip"`, from its `ip` tag).
   */
  hostsReceived: { origin: string; requests: number; source: "url" | "ip" }[];
  otherHostsCount: number;
  checks: { name: string; passes: number; fails: number }[];
  groups: { name: string; durationMs: (LatencyPercentiles & LatencySummary) | null }[];
  customMetrics: CustomMetricSummary[];
  scriptThresholds: { metric: string; expressions: string[] }[];
  /** `not-evaluated`: the script defines thresholds, but k6 was stopped before it reported their outcome. */
  scriptThresholdsOutcome: "crossed" | "not-crossed" | "none-defined" | "not-evaluated";
  apiPilotThresholds: { thresholdId: string; measured: number | null; passed: boolean }[];
  timeline: { bucketMs: number; points: TimelinePoint[] };
  findings: UserScriptFinding[];
  findingsRulesetVersion: number;
  latencyPrecision: "within-1-percent";
}

/** One execution of a user script against one environment (spec Key Entities, research R9). */
export interface UserScriptRun {
  id: string;
  source: "user-script";
  status: PerformanceRunStatus;
  cancelReason?: PerformanceRunCancelReason;
  /** `k6Message` (at most 2,000 characters) only on `GET /runs/:runId` (FR-029). */
  failure?: { category: PerformanceRunFailureCategory; k6Message?: string };
  environment: PerformanceRunEnvironment;
  snapshot: UserScriptRunSnapshot;
  k6Version: string;
  k6ExitCode: number | null;
  exitMeaning: K6ExitMeaning | null;
  /** Null when the script's own load settings are used. */
  plannedDurationMs: number | null;
  startedAt: string;
  endedAt?: string;
  cancelRequested: boolean;
  progress?: UserScriptRunProgress;
  result?: UserScriptResult;
}

/** `GET /runs` rows: no progress or result, and no k6 message. */
export type UserScriptRunSummary = Omit<UserScriptRun, "progress" | "result" | "failure"> & {
  failure?: { category: PerformanceRunFailureCategory };
};

/**
 * FR-026 (amended 2026-10-01; research R11): which environment variable names a mapping may set.
 * A name k6 reads at start-up would replace that part of its own environment, so those are
 * refused alongside k6's `K6_` options. Compared without case, as Windows environment names are.
 * Shared so the backend's check and the frontend's mapping editor apply the same rule.
 */
const RESERVED_STARTUP_NAMES: ReadonlySet<string> = new Set(["PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "TMPDIR"]);

export const MAX_MAPPING_NAME_LENGTH = 128;

export function validateMappingName(name: string): MappingNameRefusal | null {
  if (name.length === 0 || name.length > MAX_MAPPING_NAME_LENGTH || !/^[A-Za-z0-9_]+$/.test(name)) return "invalid-characters";
  if (/^\d/.test(name)) return "starts-with-digit";
  if (/^k6_/i.test(name)) return "k6-prefix";
  if (RESERVED_STARTUP_NAMES.has(name.toUpperCase())) return "reserved-startup-name";
  return null;
}

export const MAPPING_NAME_REFUSAL_TEXT: Readonly<Record<MappingNameRefusal, string>> = {
  "invalid-characters": "A name may contain only letters, digits and underscores, up to 128 characters.",
  "starts-with-digit": "A name may not start with a digit.",
  "k6-prefix": "Names starting with K6_ are k6's own options and cannot be set from a mapping.",
  "reserved-startup-name": "k6 needs this name to start (PATH, SYSTEMROOT, TEMP, TMP, HOME, TMPDIR), so it cannot be mapped.",
};
