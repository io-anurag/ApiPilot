import type { RequestGroupResult, UserScriptResult, UserScriptRun, UserScriptThreshold } from "@apipilot/shared-domain";
import { bytes, clock, escapeHtml, formatCount, ms, PHASE_TEXT, pct, REPORT_CSP, STYLE, timelineSvg, timelineTable } from "./renderHtmlReport";
import { OTHER_REQUESTS } from "./userScriptAggregate";

/**
 * The self-contained report of a user-supplied script's run (specs/034-run-user-k6-script FR-030 to
 * FR-036; research R16). It shows only what k6 measured: no journey, step, scenario, expected
 * status or anything derived from a specification (FR-031). It reuses AP-029's report helpers, so
 * both reports look alike and keep the same rules: a strict CSP, no script, no external asset,
 * every string escaped and locale-free numbers. Deterministic for the same run record.
 */

export const USER_SCRIPT_PROVENANCE = "Script supplied by the engineer and not generated or verified by ApiPilot.";
export const LOAD_ORIGIN = "Load was generated from the machine running the ApiPilot backend.";
export const NAMING_HINT = 'Name a request in k6 with its params, for example http.get(url, { tags: { name: "GET /orders/{id}" } }), so requests that differ only by an id are grouped together.';

const EXIT_TEXT: Record<NonNullable<UserScriptRun["exitMeaning"]>, string> = {
  completed: "completed (exit code 0)",
  "script-thresholds-crossed": "completed; thresholds defined in the script were crossed (exit code 99)",
  "aborted-by-script": "the script stopped the test (exit code 108)",
  "marked-failed-by-script": "the script marked the test as failed (exit code 110)",
  "invalid-config": "k6 refused the script's configuration (exit code 104)",
  "script-exception": "the script threw an error (exit code 107)",
  other: "k6 exited with another code",
};

function statusBadge(run: UserScriptRun): string {
  const labels: Record<UserScriptRun["status"], string> = {
    "in-progress": "In progress",
    completed: "Completed",
    cancelled: run.cancelReason === "backend-restart" ? "Cancelled · backend restart" : "Cancelled · by you",
    failed: `Failed · ${run.failure?.category ?? "unknown"}`,
  };
  const tone = run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "neutral";
  return `<span class="badge ${tone}">${escapeHtml(labels[run.status])}</span>`;
}

function loadText(run: UserScriptRun): string {
  const { load } = run.snapshot;
  if (load.kind === "script") return "The script's own load settings";
  return `${load.profile.kind} profile · ${load.profile.stages.map((stage) => `${Math.round(stage.durationMs / 1000)} s → ${stage.targetVirtualUsers}`).join(", ")}`;
}

function mappingText(run: UserScriptRun): string {
  if (run.snapshot.mapping.length === 0) return "None";
  return run.snapshot.mapping
    .map((entry) => `<code>${escapeHtml(entry.name)}</code> ← ${entry.source.kind === "base-url" ? "environment base URL" : `environment value <code>${escapeHtml(entry.source.valueName)}</code>`}`)
    .join("<br>");
}

function thresholdLabel(threshold: UserScriptThreshold): string {
  const where = threshold.scope.kind === "run" ? "Run" : threshold.scope.name;
  const unit = threshold.metric === "error-rate" ? "%" : " ms";
  return `${where} ${threshold.metric === "error-rate" ? "failure rate" : threshold.metric} ≤ ${threshold.limit}${unit}`;
}

function apiPilotThresholds(run: UserScriptRun, result: UserScriptResult): string {
  const thresholds = run.snapshot.thresholds;
  if (thresholds.length === 0) return "<p>No thresholds were set in ApiPilot.</p>";
  const outcomes = new Map(result.apiPilotThresholds.map((outcome) => [outcome.thresholdId, outcome]));
  const rows = thresholds
    .map((threshold) => {
      const outcome = outcomes.get(threshold.id);
      const unit = threshold.metric === "error-rate" ? "%" : " ms";
      const measured = outcome?.measured === null || outcome?.measured === undefined ? "—" : `${formatCount(outcome.measured)}${unit}`;
      const verdict = outcome?.passed ? '<span class="badge ok">Passed</span>' : '<span class="badge bad">Failed</span>';
      return `<tr><td>${escapeHtml(thresholdLabel(threshold))}</td><td class="num">${escapeHtml(measured)}</td><td>${verdict}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Threshold set in ApiPilot</th><th class="num">Measured</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const SCRIPT_OUTCOME_TEXT: Record<UserScriptResult["scriptThresholdsOutcome"], string> = {
  crossed: '<span class="badge bad">Crossed</span> k6 reported that at least one of them was crossed.',
  "not-crossed": '<span class="badge ok">Not crossed</span> k6 reported none of them crossed.',
  "none-defined": "The script defines no thresholds.",
  "not-evaluated": '<span class="badge neutral">Not evaluated</span> k6 was stopped before it reported their outcome.',
};

function scriptThresholds(result: UserScriptResult): string {
  const list =
    result.scriptThresholds.length === 0
      ? ""
      : `<ul>${result.scriptThresholds.map((entry) => `<li><code>${escapeHtml(entry.metric)}</code>: ${entry.expressions.map((expression) => `<code>${escapeHtml(expression)}</code>`).join(", ")}</li>`).join("")}</ul>`;
  return `<p>${SCRIPT_OUTCOME_TEXT[result.scriptThresholdsOutcome]} k6 reports this outcome for the run as a whole.</p>${list}`;
}

function tiles(result: UserScriptResult): string {
  const t = result.totals;
  const tile = (key: string, value: string, note = "") => `<div class="tile"><div class="k">${key}</div><div class="v">${value}</div>${note ? `<div class="small muted">${note}</div>` : ""}</div>`;
  return [
    '<div class="tiles">',
    tile("Requests", formatCount(t.requests)),
    tile("Throughput", `${formatCount(t.throughputPerSecond)}/s`),
    tile("Failure rate", pct(t.failureRatePercent), `${formatCount(t.failures)} failed, as k6 counts them`),
    tile("p50 latency", ms(t.latencyMs?.p50)),
    tile("p95 latency", ms(t.latencyMs?.p95)),
    tile("p99 latency", ms(t.latencyMs?.p99)),
    t.latencySummaryMs ? tile("Max latency", ms(t.latencySummaryMs.max), `min ${ms(t.latencySummaryMs.min)} · mean ${ms(t.latencySummaryMs.mean)}`) : "",
    tile("Iterations", formatCount(t.iterations), t.iterationDurationMs ? `p95 ${ms(t.iterationDurationMs.p95)} each` : ""),
    tile("Data received", bytes(t.dataReceivedBytes), `${bytes(t.dataSentBytes)} sent`),
    "</div>",
  ].join("");
}

function statuses(group: RequestGroupResult): string {
  return group.statusesReceived.map((entry) => `${entry.status === 0 ? "No response" : entry.status} × ${formatCount(entry.count)}`).join(", ") || "—";
}

function groupName(group: RequestGroupResult): string {
  return `<code>${escapeHtml(group.displayName)}</code>${group.named ? "" : ' <span class="small muted">(not named)</span>'}`;
}

function groupRows(groups: RequestGroupResult[]): string {
  return groups
    .map((group) => {
      const latency = group.latencyMs;
      const summary = group.latencySummaryMs;
      return [
        `<tr${group.failures > 0 ? ' class="failing"' : ""}>`,
        `<td>${groupName(group)}</td>`,
        `<td class="num">${formatCount(group.requests)}</td>`,
        `<td class="num">${formatCount(group.throughputPerSecond)}</td>`,
        `<td class="num">${pct(group.failureRatePercent)}</td>`,
        `<td class="num">${ms(summary?.min)}</td><td class="num">${ms(latency?.p50)}</td><td class="num">${ms(latency?.p90)}</td><td class="num">${ms(latency?.p95)}</td><td class="num">${ms(latency?.p99)}</td><td class="num">${ms(summary?.max)}</td>`,
        `<td>${escapeHtml(statuses(group))}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
}

function phaseRows(group: RequestGroupResult): string {
  if (group.phaseTimings.length === 0) return "";
  const rows = group.phaseTimings.map((timing) => `<tr><td>${escapeHtml(PHASE_TEXT[timing.phase])}</td><td class="num">${ms(timing.meanMs)}</td><td class="num">${ms(timing.p95Ms)}</td></tr>`).join("");
  return `<dt>Request phases</dt><dd><table class="phases"><thead><tr><th>Phase</th><th class="num">Mean</th><th class="num">p95</th></tr></thead><tbody>${rows}</tbody></table></dd>`;
}

function groupDetails(groups: RequestGroupResult[]): string {
  return groups
    .map((group) => {
      const over = group.timeline
        .map((point) => `<tr><td class="num">${clock(point.offsetMs)}</td><td class="num">${formatCount(point.requests)}</td><td class="num">${formatCount(point.errors)}</td><td class="num">${ms(point.p95Ms)}</td></tr>`)
        .join("");
      const writes = group.writes.map((entry) => `${entry.method}: ${formatCount(entry.sent)} sent, ${formatCount(entry.succeeded)} succeeded`).join("; ");
      return [
        `<details><summary>${groupName(group)}<span class="glance${group.failures > 0 ? " fail-text" : ""}">${formatCount(group.requests)} requests · ${pct(group.failureRatePercent)} failed · p95 ${ms(group.latencyMs?.p95)}</span></summary>`,
        '<dl class="why">',
        `<dt>Statuses received</dt><dd>${escapeHtml(statuses(group))}</dd>`,
        writes ? `<dt>Write requests</dt><dd>${escapeHtml(writes)}</dd>` : "",
        phaseRows(group),
        `<dt>Latency and failures over time</dt><dd><table class="phases"><thead><tr><th class="num">At</th><th class="num">Requests</th><th class="num">Failed</th><th class="num">p95</th></tr></thead><tbody>${over}</tbody></table></dd>`,
        "</dl>",
        "</details>",
      ].join("");
    })
    .join("");
}

function writesTable(groups: RequestGroupResult[]): string {
  const rows = groups.flatMap((group) =>
    group.writes.map((entry) => `<tr><td>${groupName(group)}</td><td><span class="method">${escapeHtml(entry.method)}</span></td><td class="num">${formatCount(entry.sent)}</td><td class="num">${formatCount(entry.succeeded)}</td></tr>`),
  );
  if (rows.length === 0) return "<p>No write requests (POST, PUT, PATCH or DELETE) were sent.</p>";
  return `<table><thead><tr><th>Request name</th><th>Method</th><th class="num">Sent</th><th class="num">Succeeded</th></tr></thead><tbody>${rows.join("")}</tbody></table><p class="small muted">ApiPilot does not clean up anything a run creates.</p>`;
}

function customMetrics(result: UserScriptResult): string {
  if (result.customMetrics.length === 0) return "<p>The script recorded no custom metrics.</p>";
  const rows = result.customMetrics
    .map((metric) => {
      let summary: string;
      switch (metric.type) {
        case "counter":
          summary = `total ${formatCount(metric.total)} · ${formatCount(metric.ratePerSecond)}/s`;
          break;
        case "gauge":
          summary = `last ${formatCount(metric.last)} · min ${formatCount(metric.min)} · max ${formatCount(metric.max)}`;
          break;
        case "rate":
          summary = `${pct(metric.percentTrue)} true of ${formatCount(metric.samples)}`;
          break;
        case "trend":
          summary = `p50 ${formatCount(metric.percentiles.p50)} · p95 ${formatCount(metric.percentiles.p95)} · p99 ${formatCount(metric.percentiles.p99)} · min ${formatCount(metric.summary.min)} · mean ${formatCount(metric.summary.mean)} · max ${formatCount(metric.summary.max)}`;
          break;
      }
      return `<tr><td><code>${escapeHtml(metric.name)}</code></td><td>${escapeHtml(metric.type)}</td><td>${escapeHtml(summary)}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Metric</th><th>Type</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function checksAndGroups(result: UserScriptResult): string {
  const checks =
    result.checks.length === 0
      ? "<p>The script made no checks.</p>"
      : `<table><thead><tr><th>Check</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Pass rate</th></tr></thead><tbody>${result.checks
          .map((check) => {
            const total = check.passes + check.fails;
            return `<tr${check.fails > 0 ? ' class="failing"' : ""}><td>${escapeHtml(check.name)}</td><td class="num">${formatCount(check.passes)}</td><td class="num">${formatCount(check.fails)}</td><td class="num">${pct(total === 0 ? 0 : Math.round((check.passes / total) * 10_000) / 100)}</td></tr>`;
          })
          .join("")}</tbody></table>`;
  const groups =
    result.groups.length === 0
      ? "<p>The script uses no groups.</p>"
      : `<table><thead><tr><th>Group</th><th class="num">p50</th><th class="num">p95</th><th class="num">Max</th></tr></thead><tbody>${result.groups
          .map((group) => `<tr><td>${escapeHtml(group.name)}</td><td class="num">${ms(group.durationMs?.p50)}</td><td class="num">${ms(group.durationMs?.p95)}</td><td class="num">${ms(group.durationMs?.max)}</td></tr>`)
          .join("")}</tbody></table>`;
  return `<h2>Checks</h2>${checks}<h2>Groups</h2>${groups}`;
}

function hosts(result: UserScriptResult): string {
  if (result.hostsReceived.length === 0) return "<p>No request was measured.</p>";
  const rows = result.hostsReceived
    .map((entry) => `<tr><td><code>${escapeHtml(entry.origin)}</code>${entry.source === "ip" ? ' <span class="small muted">(address; named requests)</span>' : ""}</td><td class="num">${formatCount(entry.requests)}</td></tr>`)
    .join("");
  const more = result.otherHostsCount > 0 ? `<p class="small muted">And ${formatCount(result.otherHostsCount)} more hosts, not listed.</p>` : "";
  const note = result.hostsReceived.some((entry) => entry.source === "ip")
    ? '<p class="small muted">k6 replaces a named request\'s URL with its name, so named requests are counted by the server address k6 connected to.</p>'
    : "";
  return `<table><thead><tr><th>Host</th><th class="num">Requests</th></tr></thead><tbody>${rows}</tbody></table>${more}${note}`;
}

export function renderUserScriptReport(run: UserScriptRun): string {
  const result = run.result;
  const head = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>ApiPilot k6 script report · run ${escapeHtml(run.id.slice(0, 8))}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    `<h1>k6 script report · run ${escapeHtml(run.id.slice(0, 8))} ${statusBadge(run)}</h1>`,
    `<p><strong>${USER_SCRIPT_PROVENANCE}</strong> ${LOAD_ORIGIN}</p>`,
    '<p class="muted small">Generated by ApiPilot from the stored run. Only k6\'s own measurements are shown. Latency percentiles are within 1%; minimum, mean and maximum are exact. No request or response bodies, environment values or full URLs are recorded.</p>',
    '<dl class="meta">',
    `<div><dt>Script</dt><dd>${escapeHtml(run.snapshot.scriptName)}</dd><dd class="small"><code>sha256 ${escapeHtml(run.snapshot.scriptSha256)}</code></dd></div>`,
    `<div><dt>Environment</dt><dd>${escapeHtml(run.environment.name)} <span class="badge neutral">Tier: ${escapeHtml(run.environment.tier)}</span></dd><dd><code>${escapeHtml(run.environment.baseUrl)}</code></dd></div>`,
    `<div><dt>Load used</dt><dd>${escapeHtml(loadText(run))}</dd></div>`,
    `<div><dt>k6 · outcome</dt><dd><code>v${escapeHtml(run.k6Version)}</code></dd><dd class="small">${escapeHtml(run.exitMeaning ? EXIT_TEXT[run.exitMeaning] : "k6 was stopped")}</dd></div>`,
    `<div><dt>Started · ended</dt><dd><code>${escapeHtml(run.startedAt)}</code></dd><dd><code>${escapeHtml(run.endedAt ?? "—")}</code></dd></div>`,
    `<div><dt>Mapped environment values</dt><dd class="small">${mappingText(run)}</dd><dd class="small muted">Names and sources only; values are never recorded.</dd></div>`,
    "</dl>",
  ];
  if (!result || result.totals.requests === 0) {
    const failure = run.failure ? ` (failure: ${escapeHtml(run.failure.category)}). k6's own message, if any, is shown on the run's page in ApiPilot, not in this report.` : ".";
    return [...head, `<p>This run recorded no request measurements${failure}</p>`, "</body>", "</html>", ""].join("\n");
  }
  const groups = [...result.requestGroups, ...(result.otherRequests ? [result.otherRequests] : [])];
  const { points, bucketMs } = result.timeline;
  const body = [
    tiles(result),
    "<h2>Thresholds</h2>",
    apiPilotThresholds(run, result),
    "<h3>Thresholds defined in the script</h3>",
    scriptThresholds(result),
    "<h2>Findings</h2>",
    result.findings.length === 0 ? "<p>No rule produced a finding for this run.</p>" : `<ol class="findings">${result.findings.map((finding) => `<li>${escapeHtml(finding.message)}</li>`).join("")}</ol>`,
    "<h2>Timeline</h2>",
    '<p class="small muted">Each panel has its own scale. Hover over an interval for its figures.</p>',
    timelineSvg(points, bucketMs),
    timelineTable(points, bucketMs),
    "<h2>By request name</h2>",
    '<div class="scroll"><table><thead><tr><th>Request name</th><th class="num">Requests</th><th class="num">Req/s</th><th class="num">Failure rate</th><th class="num">Min</th><th class="num">p50</th><th class="num">p90</th><th class="num">p95</th><th class="num">p99</th><th class="num">Max</th><th>Statuses received</th></tr></thead>',
    `<tbody>${groupRows(groups)}</tbody></table></div>`,
    '<p class="small muted">A request is a failure when k6 counts it as one (http_req_failed). A request the script did not name is shown by method, host and path, without its query string.</p>',
    result.otherRequests ? `<p>${formatCount(result.otherRequests.combinedNames)} request names beyond the first 100 are combined into "${OTHER_REQUESTS}". ${escapeHtml(NAMING_HINT)}</p>` : "",
    "<h2>Each request name over time</h2>",
    groupDetails(groups),
    "<h2>Hosts that received requests</h2>",
    hosts(result),
    "<h2>What the run changed on the target</h2>",
    writesTable(groups),
    checksAndGroups(result),
    "<h2>Custom metrics</h2>",
    customMetrics(result),
  ];
  return [...head, ...body, "</body>", "</html>", ""].join("\n");
}
