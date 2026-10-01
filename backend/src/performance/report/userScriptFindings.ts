import type { K6ExitMeaning, UserScriptFinding, UserScriptResult, UserScriptRun } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { originOf } from "./userScriptAggregate";
import { evaluateUserScriptThresholds, scriptThresholdsOutcome } from "./userScriptThresholds";

/**
 * Plain-language findings for a user script's run from fixed rules on the measured data
 * (specs/034-run-user-k6-script FR-036; research R16). The rules run in a fixed order and break
 * ties by display name, so the same data always gives the same findings.
 */

function clock(offsetMs: number): string {
  const seconds = Math.round(offsetMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ms(value: number): string {
  return `${value} ms`;
}

const SCRIPT_ENDED: Partial<Record<K6ExitMeaning, string>> = {
  "aborted-by-script": "The script stopped the test itself (k6 exit code 108, test.abort()).",
  "marked-failed-by-script": "The script marked the test as failed (k6 exit code 110, exec.test.fail()).",
};

export function deriveUserScriptFindings(result: UserScriptResult, run: Pick<UserScriptRun, "environment" | "exitMeaning">): UserScriptFinding[] {
  const findings: UserScriptFinding[] = [];

  const failed = result.apiPilotThresholds.filter((outcome) => !outcome.passed);
  if (failed.length > 0) {
    findings.push({
      ruleId: "apipilot-threshold-failed",
      subjects: failed.map((outcome) => outcome.thresholdId),
      message: `${failed.length} of ${result.apiPilotThresholds.length} thresholds set in ApiPilot failed.`,
      values: { failed: failed.length, total: result.apiPilotThresholds.length },
    });
  }

  if (result.scriptThresholdsOutcome === "crossed") {
    findings.push({
      ruleId: "script-thresholds-crossed",
      subjects: result.scriptThresholds.map((entry) => entry.metric),
      message: "k6 reported that at least one threshold defined in the script was crossed (exit code 99).",
      values: {},
    });
  }

  const measured = [...result.requestGroups, ...(result.otherRequests ? [result.otherRequests] : [])].filter((group) => group.latencyMs);
  const slowest = [...measured].sort((a, b) => b.latencyMs!.p95 - a.latencyMs!.p95 || compareCodeUnits(a.displayName, b.displayName))[0];
  if (slowest) {
    findings.push({
      ruleId: "slowest-request",
      subjects: [slowest.displayName],
      message: `The slowest request group was ${slowest.displayName}, with a p95 of ${ms(slowest.latencyMs!.p95)}.`,
      values: { p95Ms: slowest.latencyMs!.p95 },
    });
  }

  const firstFailing = result.timeline.points.find((point) => point.errors > 0);
  if (firstFailing) {
    const inBucket = measured
      .map((group) => ({ name: group.displayName, errors: group.timeline.find((point) => point.offsetMs === firstFailing.offsetMs)?.errors ?? 0 }))
      .filter((entry) => entry.errors > 0)
      .sort((a, b) => b.errors - a.errors || compareCodeUnits(a.name, b.name));
    findings.push({
      ruleId: "failures-start",
      subjects: inBucket.slice(0, 1).map((entry) => entry.name),
      message: `Failures started ${clock(firstFailing.offsetMs)} into the run${inBucket[0] ? `, first in ${inBucket[0].name}` : ""}.`,
      values: { offsetMs: firstFailing.offsetMs },
    });
  }

  const failing = result.totals.statusesReceived
    .filter((entry) => entry.status === 0 || entry.status >= 400)
    .sort((a, b) => b.count - a.count || a.status - b.status)[0];
  if (failing) {
    findings.push({
      ruleId: "most-frequent-failing-status",
      subjects: [String(failing.status)],
      message:
        failing.status === 0
          ? `The most frequent failure was no response at all (${failing.count} requests).`
          : `The most frequent failing status was ${failing.status} (${failing.count} responses).`,
      values: { status: failing.status, count: failing.count },
    });
  }

  if (result.otherRequests) {
    findings.push({
      ruleId: "names-combined",
      subjects: [],
      message: `${result.otherRequests.combinedNames} request names beyond the first 100 were combined into "Other requests". Name requests in k6 with params such as { tags: { name: "GET /orders/{id}" } } to group them.`,
      values: { combinedNames: result.otherRequests.combinedNames },
    });
  }

  // A URL origin is compared with the base URL's origin. An address (a named request) is compared
  // only when the base URL names an IP address itself; a host name cannot be matched to an address.
  const environmentOrigin = originOf(run.environment.baseUrl);
  const environmentHost = environmentOrigin ? new URL(run.environment.baseUrl).hostname.replace(/^\[|\]$/g, "") : null;
  const isIpLiteral = environmentHost !== null && /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]+)$/i.test(environmentHost);
  const outside = result.hostsReceived
    .filter((entry) => (entry.source === "url" ? entry.origin !== environmentOrigin : isIpLiteral && entry.origin !== environmentHost))
    .map((entry) => entry.origin);
  if (outside.length > 0 || result.otherHostsCount > 0) {
    findings.push({
      ruleId: "hosts-outside-environment",
      subjects: outside,
      message: `Requests went to hosts other than the environment's base URL: ${[...outside, ...(result.otherHostsCount > 0 ? [`and ${result.otherHostsCount} more`] : [])].join(", ")}.`,
      values: { hosts: outside.length + result.otherHostsCount },
    });
  }

  const ended = run.exitMeaning ? SCRIPT_ENDED[run.exitMeaning] : undefined;
  if (ended) findings.push({ ruleId: "script-ended-run", subjects: [], message: ended, values: {} });

  return findings;
}

/** Fills the fields that depend on the run's settings and k6's exit code. */
export function withUserScriptReportFields(
  result: UserScriptResult,
  run: Pick<UserScriptRun, "environment" | "exitMeaning" | "snapshot">,
  exitCode: number | null,
): UserScriptResult {
  const filled: UserScriptResult = {
    ...result,
    apiPilotThresholds: evaluateUserScriptThresholds(run.snapshot.thresholds, result),
    scriptThresholdsOutcome: scriptThresholdsOutcome(exitCode, result),
  };
  return { ...filled, findings: deriveUserScriptFindings(filled, run) };
}
