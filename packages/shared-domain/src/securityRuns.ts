import type { RunConfirmation, RunLimits, ScenarioResult, SecurityRun } from "./securityLab";

/**
 * Security Lab run planning and run views (specs/057 contracts/security-lab-api.md "Runs"). These are the shapes
 * the preview, start and read routes exchange. A run view never carries the owner id or the starting session id
 * (both are cookie values), and never a credential, a test data value or a host allow-list.
 */

export const RUN_PLAN_PROBLEM_CODES = [
  "profile_invalid",
  "no_items",
  "duplicate_item",
  "scenario_not_found",
  "stale_version",
  "not_approved",
  "approval_not_current",
  "specification_not_loaded",
  "operation_changed",
  "operation_missing",
  "category_not_permitted",
  "destructive_not_permitted",
  "destructive_not_approved",
  "prerequisite_unmet",
  "request_not_buildable",
  "budget_exceeded",
  "limit_invalid",
  "limit_above_profile",
] as const;
export type RunPlanProblemCode = (typeof RUN_PLAN_PROBLEM_CODES)[number];

export interface RunPlanProblem {
  code: RunPlanProblemCode;
  message: string;
  scenarioId?: string;
  version?: number;
  /** For `budget_exceeded`: the planned and the allowed request counts. */
  required?: number;
  allowed?: number;
}

export interface RunRequestItem {
  id: string;
  version: number;
}

/** The body of `POST /runs/preview`, and the plan part of `POST /runs`. */
export interface RunRequestInput {
  profileId: string;
  items: RunRequestItem[];
  limits?: Partial<RunLimits>;
}

export interface PlannedScenarioSummary {
  scenarioId: string;
  version: number;
  title: string;
  operationKey: string;
  categoryId: string;
  plannedRequests: number;
  destructive: boolean;
}

export interface RunPreviewSummary {
  profileName: string;
  environmentName: string;
  tier: string;
  baseUrl: string;
  tlsPolicy: string;
  scenarioCount: number;
  plannedRequests: number;
  cleanupRequests: number;
  destructive: PlannedScenarioSummary[];
  /** The distinct hosts and ports a request will be sent to. */
  destinations: { host: string; port: number }[];
  limits: RunLimits;
  permittedCategories: string[];
  /** Fixed wording: the engineer is told plainly that this sends real requests. */
  statement: string;
}

export interface RunPreview {
  summary: RunPreviewSummary;
  scenarios: PlannedScenarioSummary[];
  planDigest: string;
  problems: RunPlanProblem[];
}

/** The body of `POST /runs`. */
export interface StartRunInput extends RunRequestInput {
  planDigest: string;
  confirmation: RunConfirmation;
}

export type SecurityRunView = Omit<SecurityRun, "ownerId" | "sessionId">;

export interface SecurityRunProgress {
  planned: number;
  finished: number;
  inFlight: number;
}

export interface RunDetail {
  run: SecurityRunView;
  results: ScenarioResult[];
  progress: SecurityRunProgress;
}


