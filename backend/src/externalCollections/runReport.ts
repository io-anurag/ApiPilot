import type {
  EnvironmentTier,
  ExecutionRunStatus,
  UploadedCollectionExecutionRun,
  UploadedRequestResult,
} from "@apipilot/shared-domain";

/**
 * The content of a downloadable run report, derived from a finished uploaded-collection run. Built
 * as plain data first (pure, testable without parsing a PDF), then drawn by `runReportPdf.ts`.
 *
 * It carries outcomes only: request names, methods, status codes, durations and test names with
 * their (already redacted) failure messages. It never carries request or response headers or bodies
 * (`rawCapture`), the collection's variables, or anything from the uploaded files beyond the names
 * the run itself recorded, so a report can be shared without leaking credentials.
 */
export interface RunReportRow {
  position: number;
  method: string;
  name: string;
  /** Always a word; colour in the PDF is only a reinforcement. */
  outcome: "Passed" | "Failed" | "Not attempted";
  /** Why it failed or was not attempted, when known. */
  reason?: string;
  statusCode?: number;
  durationMs: number;
  edited: boolean;
  failedTests: { name: string; detail?: string }[];
  passedTestCount: number;
}

export interface RunReportModel {
  collectionName: string;
  tier: EnvironmentTier;
  runId: string;
  status: ExecutionRunStatus;
  statusLabel: string;
  startedAt: string;
  completedAt?: string;
  summary: { total: number; passed: number; failed: number; notAttempted: number; durationMs: number };
  rows: RunReportRow[];
}

const STATUS_LABEL: Record<ExecutionRunStatus, string> = {
  "in-progress": "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const FAILURE_LABEL: Record<NonNullable<UploadedRequestResult["failureCategory"]>, string> = {
  "assertion-failed": "Assertion failed",
  "connectivity-failure": "Connectivity failure",
  timeout: "Timed out",
};

const NOT_ATTEMPTED_LABEL: Record<NonNullable<UploadedRequestResult["notAttemptedReason"]>, string> = {
  cancelled: "Cancelled",
  "dependency-not-met": "Dependency not met",
  "run-ended-before-reached": "Run ended before this request",
};

/** What each reason means, in plain words, for a reader who did not run it. */
export const REASON_EXPLANATION: Record<string, string> = {
  "Assertion failed": "A response came back, but at least one of the request's tests did not pass.",
  "Connectivity failure": "No response was received, for example because the host could not be reached or refused the connection.",
  "Timed out": "The server did not respond within the time limit.",
  Cancelled: "The run was cancelled before this request was sent.",
  "Dependency not met": "An earlier request this one depends on did not succeed, so it was not sent.",
  "Run ended before this request": "The run stopped before reaching this request.",
};


/**
 * The colour of each HTTP method in the reports, the same as the app's method badges (AP-042). `text` is
 * the label colour: white on the dark fills, near-black on the three bright ones.
 */
export const REPORT_METHOD_COLOURS: Record<string, { fill: string; text: string }> = {
  GET: { fill: "#2563eb", text: "#ffffff" },
  POST: { fill: "#15803d", text: "#ffffff" },
  PUT: { fill: "#f59e0b", text: "#1a1000" },
  PATCH: { fill: "#a21caf", text: "#ffffff" },
  DELETE: { fill: "#dc2626", text: "#ffffff" },
  HEAD: { fill: "#22d3ee", text: "#1a1000" },
  OPTIONS: { fill: "#a3e635", text: "#1a1000" },
};

/** A test's failure message can be long and multi-line; the report keeps its first line. */
const DETAIL_LIMIT = 240;

function firstLine(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const line = detail.split(/\r?\n/)[0].trim();
  if (line.length === 0) return undefined;
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT - 1)}…` : line;
}

function toRow(result: UploadedRequestResult, index: number): RunReportRow {
  let outcome: RunReportRow["outcome"] = "Not attempted";
  let reason: string | undefined;
  if (result.outcome === "passed") {
    outcome = "Passed";
  } else if (result.outcome === "failed") {
    outcome = "Failed";
    reason = result.failureCategory ? FAILURE_LABEL[result.failureCategory] : undefined;
  } else {
    reason = result.notAttemptedReason ? NOT_ATTEMPTED_LABEL[result.notAttemptedReason] : undefined;
  }
  return {
    position: index + 1,
    method: result.requestMethod.toUpperCase(),
    name: result.requestName,
    outcome,
    reason,
    statusCode: result.responseStatusCode,
    durationMs: result.durationMs,
    edited: result.wasEdited === true,
    failedTests: result.testOutcomes
      .filter((test) => test.outcome === "failed")
      .map((test) => ({ name: test.name, detail: firstLine(test.detail) })),
    passedTestCount: result.testOutcomes.filter((test) => test.outcome === "passed").length,
  };
}

/** Pure: the same run always gives the same model. */
export function buildRunReportModel(run: UploadedCollectionExecutionRun): RunReportModel {
  return {
    collectionName: run.uploadedCollectionSnapshot.name,
    tier: run.uploadedCollectionSnapshot.tier,
    runId: run.id,
    status: run.status,
    statusLabel: STATUS_LABEL[run.status],
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    summary: { ...run.summary },
    rows: run.results.map(toRow),
  };
}

/** `2026-10-10 14:25:19 UTC`; fixed format and zone so a report does not depend on the server's locale. */
export function formatReportTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** An ASCII-only file name for the download, so no header or path needs special handling. */
export function reportFileName(model: Pick<RunReportModel, "collectionName" | "runId">, extension = "pdf"): string {
  const slug = model.collectionName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `apipilot-run-report-${slug || "collection"}-${model.runId.slice(0, 8)}.${extension}`;
}

/** Requests that failed for the same reason with the same first failure message. */
export interface FailureCluster {
  reason: string;
  /** The first failed test's message, shared by the cluster; absent when there was none. */
  message?: string;
  count: number;
  /** Position and name of each affected request, in run order. */
  requests: { position: number; name: string }[];
}

export interface MethodBreakdown {
  method: string;
  total: number;
  passed: number;
  failed: number;
  notAttempted: number;
}

/** What the HTML report adds to the plain rows: derived only from them, so it stays deterministic. */
export interface RunInsights {
  /** Passed requests as a percentage of all requests, one decimal; null for a run with none. */
  passRate: number | null;
  tests: { passed: number; failed: number };
  failures: RunReportRow[];
  clusters: FailureCluster[];
  /** The five slowest requests that were sent, slowest first. */
  slowest: RunReportRow[];
  methods: MethodBreakdown[];
}

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Digits and quoted values vary between otherwise identical failures; collapse them to group. */
function clusterKey(reason: string, message: string | undefined): string {
  const normalized = (message ?? "").toLowerCase().replace(/\d+/g, "#").replace(/(["'])(?:(?!\1).)*\1/g, "$1$1").trim();
  return `${reason}|${normalized}`;
}

export function buildRunInsights(model: RunReportModel): RunInsights {
  const rows = model.rows;
  const failures = rows.filter((row) => row.outcome === "Failed");

  const clusterMap = new Map<string, FailureCluster>();
  for (const row of failures) {
    const reason = row.reason ?? "Failed";
    const message = row.failedTests[0]?.detail;
    const key = clusterKey(reason, message);
    const cluster = clusterMap.get(key) ?? { reason, message, count: 0, requests: [] };
    cluster.count += 1;
    cluster.requests.push({ position: row.position, name: row.name });
    clusterMap.set(key, cluster);
  }
  const clusters = [...clusterMap.values()].sort((left, right) => right.count - left.count || left.requests[0].position - right.requests[0].position);

  const slowest = rows
    .filter((row) => row.outcome !== "Not attempted")
    .sort((left, right) => right.durationMs - left.durationMs || left.position - right.position)
    .slice(0, 5);

  const byMethod = new Map<string, MethodBreakdown>();
  for (const row of rows) {
    const entry = byMethod.get(row.method) ?? { method: row.method, total: 0, passed: 0, failed: 0, notAttempted: 0 };
    entry.total += 1;
    if (row.outcome === "Passed") entry.passed += 1;
    else if (row.outcome === "Failed") entry.failed += 1;
    else entry.notAttempted += 1;
    byMethod.set(row.method, entry);
  }
  const rank = (method: string) => (METHOD_ORDER.includes(method) ? METHOD_ORDER.indexOf(method) : METHOD_ORDER.length);
  const methods = [...byMethod.values()].sort((left, right) => rank(left.method) - rank(right.method) || left.method.localeCompare(right.method));

  return {
    passRate: rows.length === 0 ? null : Math.round((rows.filter((row) => row.outcome === "Passed").length / rows.length) * 1000) / 10,
    tests: {
      passed: rows.reduce((sum, row) => sum + row.passedTestCount, 0),
      failed: rows.reduce((sum, row) => sum + row.failedTests.length, 0),
    },
    failures,
    clusters,
    slowest,
    methods,
  };
}
