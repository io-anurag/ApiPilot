import type { ChainRun, ChainRunSnapshotStep, PerformanceResult, StepResult } from "@apipilot/shared-domain";
import { latencyChart, stepLatencyChart, throughputChart, virtualUsersChart } from "./chainReportCharts";
import { CHAIN_STYLE } from "./chainReportStyle";
import { bytes, clock, escapeHtml, formatCount, ms, PHASE_TEXT, pct, REPORT_CSP, timelineTable } from "./renderHtmlReport";

/**
 * The self-contained report of a request-chain run (specs/037-request-chain-performance research
 * R20; FR-033, FR-034, FR-046). Redesigned 2026-10-04: the answer (verdict, environment, load profile,
 * key figures) comes first, then line charts on one time axis, then one table of every request of the
 * run, then each step's detail. It has inline CSS with a script-free Auto / Light / Dark switch,
 * server-computed SVG and no JavaScript. It is built only from the stored run: the snapshot
 * (structure and provenance) and the measured result. It never contains request or response content: a
 * step is named by its name, method and URL template, a check by its kind and path, and nothing a run
 * sent or received is recorded. The legacy `renderHtmlReport` is untouched, so reports of earlier
 * runs render as before (FR-037).
 */

export const CHAIN_CONTENT_NOTICE = "Steps are authored by the engineer and not verified by ApiPilot.";

const RUNS_TEXT: Record<ChainRunSnapshotStep["runs"], string> = {
  "every-iteration": "Every iteration",
  "once-per-virtual-user": "Once per virtual user",
  "once-before-load": "Once before load",
};

const SETUP_REASON_TEXT: Record<string, string> = {
  status: "unexpected status",
  "no-response": "no response",
  unknown: "the test stopped before the reason was recorded",
};

function setupReason(reason: string | null): string {
  if (reason === null) return "";
  if (reason.startsWith("extractor:")) return `extractor ${reason.slice("extractor:".length)} failed`;
  if (reason.startsWith("missing-data:")) return `missing value ${reason.slice("missing-data:".length)}`;
  return SETUP_REASON_TEXT[reason] ?? reason;
}

function statusBadge(run: ChainRun): string {
  const labels: Record<ChainRun["status"], string> = {
    "in-progress": "In progress",
    completed: "Completed",
    cancelled: run.cancelReason === "backend-restart" ? "Cancelled · backend restart" : "Cancelled · by you",
    failed: run.failure?.category === "setup-step-failed" ? "Failed · a Once before load step failed" : `Failed · ${run.failure?.category ?? "unknown"}`,
  };
  const tone = run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "neutral";
  return `<span class="badge ${tone}">${escapeHtml(labels[run.status])}</span>`;
}

function sourceText(step: ChainRunSnapshotStep): string {
  const origin =
    step.source.kind === "added"
      ? "Added by you"
      : step.source.kind === "operation"
        ? `Seeded from operation ${step.source.label ?? ""}`
        : step.source.kind === "workflow"
          ? `Seeded from workflow step ${step.source.label ?? ""}`
          : `Seeded from collection request ${step.source.label ?? ""}`;
  return step.source.kind !== "added" && step.changed ? `${origin} · Changed` : origin;
}

function checkLabel(check: ChainRunSnapshotStep["checks"][number]): string {
  if (check.kind === "time-at-most") return `Response time at most ${formatCount(check.maxMs ?? 0)} ms`;
  if (check.kind === "body-contains") return "Body contains a text (set in the plan)";
  if (check.kind === "field-exists") return `Field ${check.path} exists`;
  return `Field ${check.path} equals ${check.reference ? `{{${check.reference}}}` : "a value (set in the plan)"}`;
}

function methodBadge(method: string): string {
  const known = ["get", "post", "put", "patch", "delete"].includes(method.toLowerCase()) ? ` m-${method.toLowerCase()}` : "";
  return `<span class="method${known}">${escapeHtml(method)}</span>`;
}

function stepLabel(step: ChainRunSnapshotStep): string {
  return `${escapeHtml(step.name)} <span class="small">${methodBadge(step.method)} <code>${escapeHtml(step.pathTemplate)}</code></span>`;
}

function statusText(status: string): string {
  return status === "0" ? "No response" : status;
}

/** A received status is expected when the step lists it; otherwise it is the unexpected kind of badge. */
function statusBadges(step: ChainRunSnapshotStep, measured: StepResult | undefined): string {
  if (!measured || measured.requests === 0) return '<span class="muted">—</span>';
  const entries = measured.statusesReceived ?? measured.errorsByStatus.map((entry) => ({ ...entry, expected: false }));
  if (entries.length === 0) return '<span class="muted">—</span>';
  return entries.map((entry) => `<span class="st"><span class="badge ${entry.expected ? "ok" : "bad"}">${escapeHtml(statusText(entry.status))}</span> <span class="small muted">× ${formatCount(entry.count)}</span></span>`).join("");
}

function duration(startedAt: string, endedAt: string | undefined): string {
  if (!endedAt) return "—";
  const seconds = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

function checkTotals(measured: StepResult | undefined): string {
  const checks = measured?.checks ?? [];
  if (checks.length === 0) return '<span class="muted">—</span>';
  const passed = checks.reduce((sum, entry) => sum + entry.passed, 0);
  const failed = checks.reduce((sum, entry) => sum + entry.failed, 0);
  return `<span class="${failed > 0 ? "fail-text" : ""}">${formatCount(passed)} passed${failed > 0 ? ` · ${formatCount(failed)} failed` : ""}</span>`;
}

// ── Top of the report ──────────────────────────────────────────────────────────────────────────

function verdict(run: ChainRun, result: PerformanceResult | undefined): string {
  if (!result) return `<section class="card verdict v-neutral" aria-label="Verdict"><strong>No measurements</strong><span class="muted">${run.failure ? `The run failed: ${escapeHtml(run.failure.category)}.` : "This run recorded no measurements."}</span></section>`;
  const total = run.snapshot.thresholds.length;
  const outcomes = new Map(result.thresholdOutcomes.map((outcome) => [outcome.thresholdId, outcome]));
  const failed = run.snapshot.thresholds.filter((threshold) => !outcomes.get(threshold.id)?.passed).length;
  const tone = total === 0 ? "neutral" : failed === 0 ? "ok" : "bad";
  const headline = total === 0 ? "No thresholds set" : failed === 0 ? `All ${formatCount(total)} thresholds passed` : `${formatCount(failed)} of ${formatCount(total)} thresholds failed`;
  const rest = total === 0 ? "The report gives no pass/fail verdict." : "";
  return [
    `<section class="card verdict v-${tone}" aria-label="Verdict">`,
    `<strong>${escapeHtml(headline)}</strong>`,
    rest ? `<span class="muted">${rest}</span>` : "",
    `<span class="muted">Failure rate ${escapeHtml(pct(result.totals.errorRatePercent))}</span>`,
    `<span class="muted">${formatCount(result.findings.length)} ${result.findings.length === 1 ? "finding" : "findings"}</span>`,
    "</section>",
  ].join("");
}

function facts(run: ChainRun): string {
  const snapshot = run.snapshot;
  const profile = snapshot.loadProfile.stages.map((stage) => `${Math.round(stage.durationMs / 1000)} s → ${stage.targetVirtualUsers} VUs`).join(", ");
  const seed = snapshot.seedSource ? (snapshot.seedSource.kind === "collection" ? `Collection ${snapshot.seedSource.collectionName}` : snapshot.seedSource.kind === "specification" ? `Specification ${snapshot.seedSource.filename}` : "The guided workflow") : "Built by the engineer";
  const fact = (key: string, ...values: string[]) => `<div><dt>${key}</dt>${values.map((value) => `<dd>${value}</dd>`).join("")}</div>`;
  return [
    '<dl class="facts">',
    fact("Environment", `${escapeHtml(run.environment.name)} <span class="badge neutral">Tier: ${escapeHtml(run.environment.tier)}</span>`, `<code>${escapeHtml(run.environment.baseUrl)}</code>`),
    fact("Load profile", `${escapeHtml(snapshot.loadProfile.kind)} · ${escapeHtml(profile)}`, `<span class="small muted">Default think time ${snapshot.thinkTimeMs / 1000} s</span>`),
    fact("Duration", escapeHtml(duration(run.startedAt, run.endedAt)), `<span class="small muted">Planned ${escapeHtml(duration("1970-01-01T00:00:00Z", new Date(run.plannedDurationMs).toISOString()))}</span>`),
    fact("Started · ended", `<code>${escapeHtml(run.startedAt)}</code>`, `<code>${escapeHtml(run.endedAt ?? "—")}</code>`),
    fact("k6 · script", `<code>v${escapeHtml(run.k6Version)} · sha256 ${escapeHtml(run.scriptSha256.slice(0, 12))}</code>`),
    fact("Hosts", snapshot.hosts.map((host) => `<code>${escapeHtml(host)}</code>`).join(", ") || "—"),
    fact("Seeded from", escapeHtml(seed)),
    fact("Plan", escapeHtml(snapshot.planName), `<span class="small muted">${formatCount(snapshot.chains.length)} ${snapshot.chains.length === 1 ? "chain" : "chains"} · ${formatCount(snapshot.chains.reduce((sum, chain) => sum + chain.steps.length, 0))} steps</span>`),
    "</dl>",
  ].join("");
}

function tiles(result: PerformanceResult): string {
  const t = result.totals;
  const tile = (key: string, value: string, note = "", tone = "") => `<div class="tile${tone ? ` t-${tone}` : ""}"><div class="k">${key}</div><div class="v">${value}</div>${note ? `<div class="small muted">${note}</div>` : ""}</div>`;
  return [
    '<div class="tiles">',
    tile("Requests", formatCount(t.requests), "Once before load steps not included"),
    tile("Throughput", `${formatCount(t.throughputPerSecond)}/s`),
    tile("Failure rate", pct(t.errorRatePercent), `${formatCount(t.errors)} failures`, t.errorRatePercent > 0 ? "bad" : "ok"),
    tile("p50 latency", ms(t.latencyMs?.p50)),
    tile("p95 latency", ms(t.latencyMs?.p95)),
    tile("p99 latency", ms(t.latencyMs?.p99)),
    tile("Iterations", formatCount(t.iterations), t.iterationDurationMs ? `p95 ${ms(t.iterationDurationMs.p95)} each` : ""),
    tile("Chains cut short", formatCount(t.journeysCutShort), "", t.journeysCutShort > 0 ? "bad" : ""),
    t.dataReceivedBytes !== undefined ? tile("Data received", bytes(t.dataReceivedBytes), `${bytes(t.dataSentBytes ?? 0)} sent`) : "",
    "</div>",
  ].join("");
}

function thresholdCard(run: ChainRun, result: PerformanceResult): string {
  const thresholds = run.snapshot.thresholds;
  if (thresholds.length === 0) return '<section class="card"><h2>Thresholds</h2><p>No thresholds were set, so the report gives no pass/fail verdict.</p></section>';
  const outcomes = new Map(result.thresholdOutcomes.map((outcome) => [outcome.thresholdId, outcome]));
  const names = new Map(run.snapshot.chains.flatMap((chain) => chain.steps.map((step) => [step.id, step.name] as const)));
  const rows = thresholds
    .map((threshold) => {
      const outcome = outcomes.get(threshold.id);
      const where = threshold.scope.kind === "run" ? "Run" : (names.get(threshold.scope.stepId) ?? threshold.scope.stepId);
      const unit = threshold.metric === "error-rate" ? "%" : " ms";
      const label = `${where} ${threshold.metric === "error-rate" ? "failure rate" : threshold.metric} ≤ ${threshold.limit}${unit}`;
      const measured = outcome?.measured === null || outcome?.measured === undefined ? "—" : `${formatCount(outcome.measured)}${unit}`;
      return `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(measured)}</td><td>${outcome?.passed ? '<span class="badge ok">Passed</span>' : '<span class="badge bad">Failed</span>'}</td></tr>`;
    })
    .join("");
  return `<section class="card"><h2>Thresholds</h2><div class="scroll"><table><thead><tr><th>Threshold</th><th class="num">Measured</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function findingsCard(result: PerformanceResult): string {
  return `<section class="card"><h2>Findings</h2>${
    result.findings.length === 0 ? "<p>No rule produced a finding for this run.</p>" : `<ol class="findings">${result.findings.map((finding) => `<li>${escapeHtml(finding.message)}</li>`).join("")}</ol>`
  }</section>`;
}

// ── Charts ─────────────────────────────────────────────────────────────────────────────────────

function chartsSection(run: ChainRun, result: PerformanceResult, results: Map<string, StepResult>): string {
  const { points, bucketMs } = result.timeline;
  const limit = run.snapshot.thresholds.find((threshold) => threshold.scope.kind === "run" && threshold.metric === "p95")?.limit ?? null;
  const lines = run.snapshot.chains
    .flatMap((chain) => chain.steps)
    .flatMap((step) => {
      const timeline = results.get(step.id)?.timeline;
      return timeline ? [{ label: step.name, timeline }] : [];
    });
  const perStep = stepLatencyChart(lines, points, bucketMs);
  return [
    '<section id="charts" class="card"><h2>Latency over time <span class="small muted">p95 of every request in the run</span></h2>',
    latencyChart(points, bucketMs, limit),
    "</section>",
    '<div class="charts-pair">',
    `<section class="card"><h2>Virtual users</h2>${virtualUsersChart(points, bucketMs)}</section>`,
    `<section class="card"><h2>Throughput</h2>${throughputChart(points, bucketMs)}</section>`,
    "</div>",
    perStep ? `<section class="card"><h2>Latency by step <span class="small muted">p95 per interval, one scale</span></h2>${perStep}</section>` : "",
    `<section class="card">${timelineTable(points, bucketMs)}</section>`,
  ].join("");
}

// ── Requests ───────────────────────────────────────────────────────────────────────────────────

function requestsSection(run: ChainRun, result: PerformanceResult | undefined): string {
  const results = new Map((result?.steps ?? []).map((step) => [step.stepId, step]));
  const setup = new Map((result?.setupSteps ?? []).map((entry) => [entry.stepId, entry]));
  const journeys = new Map((result?.journeys ?? []).map((journey) => [journey.journeyId, journey]));
  const slowest = Math.max(0, ...(result?.steps ?? []).map((step) => step.latencyMs?.p95 ?? 0));
  const columns = 13;
  const body = run.snapshot.chains
    .map((chain) => {
      const journey = journeys.get(chain.id);
      const summary = journey ? `${formatCount(journey.requests)} requests · ${pct(journey.errorRatePercent)} failed · p95 ${ms(journey.latencyMs?.p95)}` : "";
      const rows = chain.steps.map((step) => {
        if (step.runs === "once-before-load") {
          const outcome = setup.get(step.id);
          const verdictText = !outcome ? '<span class="badge neutral">Not sent</span>' : outcome.outcome === "ok" ? '<span class="badge ok">OK</span>' : `<span class="badge bad">Failed</span> <span class="small">${escapeHtml(setupReason(outcome.reason))}</span>`;
          return `<tr><td class="step">${stepLabel(step)}</td><td>${RUNS_TEXT[step.runs]}</td><td><code>${escapeHtml(step.expectedStatuses.join(", ") || "—")}</code></td><td>${verdictText}</td><td class="num">${outcome ? "1" : "—"}</td><td class="num">—</td><td class="num" colspan="6">${outcome ? `${ms(outcome.latencyMs)} <span class="small muted">one request, before the load</span>` : "—"}</td><td>—</td></tr>`;
        }
        const measured = results.get(step.id);
        const sent = measured !== undefined && measured.requests > 0;
        const failing = sent && measured.errorRatePercent > 0;
        const summaryMs = measured?.latencySummaryMs;
        const latency = measured?.latencyMs;
        const p95 = latency?.p95;
        const width = p95 !== undefined && slowest > 0 ? Math.max(1, Math.round((p95 / slowest) * 100)) : 0;
        const cell = (value: number | null | undefined) => `<td class="num">${sent ? ms(value) : "—"}</td>`;
        return [
          `<tr${failing ? ' class="failing"' : ""}>`,
          `<td class="step">${stepLabel(step)}</td>`,
          `<td>${RUNS_TEXT[step.runs]}</td>`,
          `<td><code>${escapeHtml(step.expectedStatuses.join(", ") || "—")}</code></td>`,
          `<td>${sent ? statusBadges(step, measured) : '<span class="badge neutral">Not sent</span>'}</td>`,
          `<td class="num">${sent ? formatCount(measured.requests) : "—"}</td>`,
          `<td class="num ${failing ? "fail-text" : ""}">${sent ? pct(measured.errorRatePercent) : "—"}</td>`,
          cell(summaryMs?.min),
          cell(summaryMs?.mean),
          cell(latency?.p50),
          `<td class="num">${sent ? `${ms(p95)}${width > 0 ? `<span class="bar${failing ? " b-bad" : ""}" style="width:${width}%" aria-hidden="true"></span>` : ""}` : "—"}</td>`,
          cell(latency?.p99),
          cell(summaryMs?.max),
          `<td>${checkTotals(measured)}</td>`,
          "</tr>",
        ].join("");
      });
      return `<tr class="chain-row"><td colspan="${columns}">${escapeHtml(chain.name)} <span class="small muted">${escapeHtml(summary)}</span></td></tr>${rows.join("")}`;
    })
    .join("");
  return [
    '<section id="requests" class="card"><h2>All requests <span class="small muted">every step of the plan, with its result</span></h2>',
    '<div class="scroll"><table class="req-table"><thead><tr>',
    '<th>Step</th><th>Runs</th><th>Expected</th><th>Received</th><th class="num">Requests</th><th class="num">Failed</th><th class="num">Min</th><th class="num">Mean</th><th class="num">p50</th><th class="num">p95</th><th class="num">p99</th><th class="num">Max</th><th>Checks</th>',
    `</tr></thead><tbody>${body}</tbody></table></div>`,
    '<p class="small muted note">A response is a failure only when its status is not among the step\'s expected statuses, or when there is no response. Failed checks and failed extractions are counted on their own and are not in the failure rate.</p>',
    "</section>",
  ].join("");
}

// ── Chains ─────────────────────────────────────────────────────────────────────────────────────

function phaseBlock(measured: StepResult | undefined): string {
  const timings = measured?.phaseTimings;
  if (!timings || timings.length === 0) return "";
  const total = timings.reduce((sum, timing) => sum + timing.meanMs, 0);
  const bar = total > 0 ? `<div class="phase-bar" role="img" aria-label="Mean time by request phase">${timings.map((timing, index) => (timing.meanMs > 0 ? `<i class="p${index + 1}" style="width:${Math.round((timing.meanMs / total) * 1000) / 10}%" title="${escapeHtml(PHASE_TEXT[timing.phase])} ${escapeHtml(ms(timing.meanMs))}"></i>` : "")).join("")}</div>` : "";
  const rows = timings.map((timing, index) => `<tr><td><i class="pk p${index + 1}"></i>${escapeHtml(PHASE_TEXT[timing.phase])}</td><td class="num">${ms(timing.meanMs)}</td><td class="num">${ms(timing.p95Ms)}</td></tr>`).join("");
  return `<dt>Request phases</dt><dd>${bar}<table class="phases"><thead><tr><th>Phase</th><th class="num">Mean</th><th class="num">p95</th></tr></thead><tbody>${rows}</tbody></table></dd>`;
}

function stepBlock(step: ChainRunSnapshotStep, measured: StepResult | undefined, cutShortHere: number): string {
  const received = measured?.statusesReceived?.map((entry) => `${statusText(entry.status)} × ${formatCount(entry.count)}`).join(", ") ?? "";
  const glance = measured && measured.requests > 0 ? `${received ? `${received} · ` : ""}p95 ${ms(measured.latencyMs?.p95)} · ${pct(measured.errorRatePercent)} failed` : "not sent";
  const failing = measured !== undefined && measured.errorRatePercent > 0;
  const extractors = step.extractorNames
    .map((name) => {
      const counts = measured?.captures?.find((entry) => entry.name === name);
      return `<li><code>${escapeHtml(name)}</code>${counts ? ` · extracted × ${formatCount(counts.succeeded)}, failed × ${formatCount(counts.failed)}` : ""}</li>`;
    })
    .join("");
  const checks = step.checks
    .map((check) => {
      const counts = measured?.checks?.find((entry) => entry.checkId === check.id);
      return `<li>${escapeHtml(checkLabel(check))}${counts ? ` · passed × ${formatCount(counts.passed)}, failed × ${formatCount(counts.failed)}` : ""}</li>`;
    })
    .join("");
  const notSent = measured ? measured.notAttempted.missingData + measured.notAttempted.dependencyNotAttempted : 0;
  return [
    `<details class="step"${failing ? " open" : ""}>`,
    `<summary>${stepLabel(step)} <span class="glance${failing ? " fail-text" : ""}">${escapeHtml(glance)}</span></summary>`,
    "<dl>",
    `<dt>Source</dt><dd>${escapeHtml(sourceText(step))}</dd>`,
    `<dt>Runs</dt><dd>${escapeHtml(RUNS_TEXT[step.runs])}</dd>`,
    `<dt>Expected</dt><dd>${escapeHtml(step.expectedStatuses.join(", ") || "—")}</dd>`,
    `<dt>Extractors</dt><dd>${extractors ? `<ul>${extractors}</ul>` : "None"}</dd>`,
    `<dt>Checks</dt><dd>${checks ? `<ul>${checks}</ul>` : "None"}</dd>`,
    cutShortHere > 0 ? `<dt>Cut short here</dt><dd>${formatCount(cutShortHere)} times</dd>` : "",
    notSent > 0 ? `<dt>Not sent</dt><dd>${formatCount(measured!.notAttempted.missingData)} missing data · ${formatCount(measured!.notAttempted.dependencyNotAttempted)} not attempted</dd>` : "",
    measured?.missingVariables.length ? `<dt>Missing values</dt><dd>${escapeHtml(measured.missingVariables.join(", "))}</dd>` : "",
    phaseBlock(measured),
    "</dl>",
    "</details>",
  ].join("");
}

function chainsSection(run: ChainRun, result: PerformanceResult | undefined): string {
  const results = new Map((result?.steps ?? []).map((step) => [step.stepId, step]));
  const journeys = new Map((result?.journeys ?? []).map((journey) => [journey.journeyId, journey]));
  return [
    '<section id="chains" class="card"><h2>Chains <span class="small muted">each step in detail</span></h2>',
    ...run.snapshot.chains.map((chain) => {
      const journey = journeys.get(chain.id);
      const iterationSteps = chain.steps.filter((step) => step.runs !== "once-before-load");
      const cutByExtractor = journey?.cutShortByCapture ? Object.entries(journey.cutShortByCapture).map(([name, count]) => `${name === "" ? "an unexpected status" : name} × ${formatCount(count)}`).join(", ") : "";
      const summary = journey
        ? `${formatCount(journey.requests)} requests · ${pct(journey.errorRatePercent)} failed · p95 ${ms(journey.latencyMs?.p95)} · cut short ${formatCount(journey.runsCutShort)}${cutByExtractor ? ` (${escapeHtml(cutByExtractor)})` : ""}`
        : iterationSteps.length === 0
          ? "No step runs in the load"
          : "Not run";
      return [
        `<div class="chain-head"><h3>${escapeHtml(chain.name)}</h3><span class="small muted">${summary}</span></div>`,
        ...iterationSteps.map((step) => stepBlock(step, results.get(step.id), journey?.cutShortAtStepId === step.id ? journey.runsCutShort : 0)),
      ].join("");
    }),
    "</section>",
  ].join("");
}

// ── Supporting sections ────────────────────────────────────────────────────────────────────────

function setupSection(run: ChainRun, result: PerformanceResult | undefined): string {
  const setupSteps = run.snapshot.chains.flatMap((chain) => chain.steps.filter((step) => step.runs === "once-before-load"));
  if (setupSteps.length === 0) return "";
  const outcomes = new Map((result?.setupSteps ?? []).map((entry) => [entry.stepId, entry]));
  const refreshes = new Map((result?.tokenRefreshes.bySetupStep ?? []).map((entry) => [entry.stepId, entry]));
  const rows = setupSteps
    .map((step) => {
      const outcome = outcomes.get(step.id);
      const verdictText = !outcome ? '<span class="badge neutral">Not sent</span>' : outcome.outcome === "ok" ? '<span class="badge ok">OK</span>' : `<span class="badge bad">Failed</span> ${escapeHtml(setupReason(outcome.reason))}`;
      const refresh = refreshes.get(step.id);
      return `<tr><td>${stepLabel(step)}</td><td>${verdictText}</td><td class="num">${ms(outcome?.latencyMs ?? null)}</td><td class="num">${refresh ? `${formatCount(refresh.refreshed)} · ${formatCount(refresh.failed)} failed` : "—"}</td></tr>`;
    })
    .join("");
  return [
    '<section id="setup" class="card">',
    "<h2>Once before load</h2>",
    '<p class="small muted">Sent once before any virtual user started; never counted in the load\'s requests or latency. A step whose response stated <code>expires_in</code> was sent again by each virtual user before it expired.</p>',
    `<div class="scroll"><table><thead><tr><th>Step</th><th>Outcome</th><th class="num">Latency</th><th class="num">Refreshes</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    result && !result.tokenRefreshes.lifetimeStated ? "<p>A Once before load response stated no lifetime, so its values were never refreshed.</p>" : "",
    result && result.tokenRefreshes.bucketOffsetsMs.length > 0 ? `<p class="small muted">Refreshes at ${result.tokenRefreshes.bucketOffsetsMs.map(clock).join(", ")}.</p>` : "",
    "</section>",
  ].join("");
}

function dataSetSection(run: ChainRun, result: PerformanceResult | undefined): string {
  if (run.snapshot.dataSets.length === 0) return "";
  const usage = new Map((result?.dataSets ?? []).map((entry) => [entry.dataSetId, entry]));
  const rows = run.snapshot.dataSets
    .map((dataSet) => {
      const used = usage.get(dataSet.id);
      const columns = dataSet.columns.map((column) => `${escapeHtml(column.name)}${column.secret ? " (secret)" : ""}`).join(", ");
      return `<tr><td>${escapeHtml(dataSet.name)}</td><td>${dataSet.mode === "row-per-virtual-user" ? "One row per virtual user" : "Next row per iteration"}</td><td>${columns}</td><td class="num">${formatCount(dataSet.rowCount)}</td><td class="num">${used ? formatCount(used.rowsUsed) : "—"}</td><td>${used?.wrapped ? "Yes" : "No"}</td><td><code>${escapeHtml(dataSet.sha256.slice(0, 12))}</code></td></tr>`;
    })
    .join("");
  return [
    '<section id="data-sets" class="card">',
    "<h2>Data sets</h2>",
    '<p class="small muted">Rows were taken in file order and wrapped to the first row when they ran out. No data set value is recorded.</p>',
    `<div class="scroll"><table><thead><tr><th>Data set</th><th>Mode</th><th>Columns</th><th class="num">Rows</th><th class="num">Rows used</th><th>Wrapped</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    "</section>",
  ].join("");
}

function writesSection(run: ChainRun, result: PerformanceResult): string {
  const snapshot = run.snapshot;
  const rows = result.writeRequests
    .map((entry) => {
      const step = snapshot.chains.flatMap((chain) => chain.steps).find((candidate) => candidate.id === entry.operationKey);
      return `<tr><td>${step ? stepLabel(step) : escapeHtml(entry.operationKey)}</td><td class="num">${formatCount(entry.sent)}</td><td class="num">${formatCount(entry.succeeded)}</td></tr>`;
    })
    .join("");
  return [
    '<section id="writes" class="card"><h2>What the run changed on the target</h2>',
    snapshot.writeSummary.total === 0
      ? "<p>The plan sends no write requests.</p>"
      : `<div class="scroll"><table><thead><tr><th>Write step</th><th class="num">Sent</th><th class="num">Succeeded</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small muted note">ApiPilot does not clean up anything a run creates.</p>`,
    "</section>",
  ].join("");
}

function nav(items: [string, string][]): string {
  return `<nav class="nav" aria-label="Report sections">${items.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("")}</nav>`;
}

/** Renders the report from a stored chain run. Deterministic for the same run record. */
export function renderChainReport(run: ChainRun): string {
  const snapshot = run.snapshot;
  const result = run.result;
  const hasSetup = snapshot.chains.some((chain) => chain.steps.some((step) => step.runs === "once-before-load"));
  const sections: [string, string][] = [
    ...(result ? ([["charts", "Charts"]] as [string, string][]) : []),
    ["requests", "Requests"],
    ["chains", "Chains"],
    ...(hasSetup ? ([["setup", "Once before load"]] as [string, string][]) : []),
    ...(snapshot.dataSets.length > 0 ? ([["data-sets", "Data sets"]] as [string, string][]) : []),
    ...(result ? ([["writes", "Writes"]] as [string, string][]) : []),
  ];
  const results = new Map((result?.steps ?? []).map((step) => [step.stepId, step]));
  const head = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>ApiPilot performance report · run ${escapeHtml(run.id.slice(0, 8))}</title>`,
    `<style>${CHAIN_STYLE}</style>`,
    "</head>",
    "<body>",
    '<div class="page">',
    '<input class="theme-input" type="radio" name="theme" id="theme-auto" checked aria-label="Theme: follow the system">',
    '<input class="theme-input" type="radio" name="theme" id="theme-light" aria-label="Theme: light">',
    '<input class="theme-input" type="radio" name="theme" id="theme-dark" aria-label="Theme: dark">',
    '<header class="top"><div>',
    `<h1>Performance report · ${escapeHtml(snapshot.planName)} ${statusBadge(run)}</h1>`,
    `<p class="muted small sub">Request-chain plan, run ${escapeHtml(run.id.slice(0, 8))}. ${CHAIN_CONTENT_NOTICE} No request or response content, extracted value or data set value is recorded.</p>`,
    "</div>",
    '<div class="theme" role="group" aria-label="Color theme"><label for="theme-auto">Auto</label><label for="theme-light">Light</label><label for="theme-dark">Dark</label></div>',
    "</header>",
    nav(sections),
    verdict(run, result),
    `<section class="card" aria-label="Run details">${facts(run)}</section>`,
  ];
  const foot = ["</div>", "</body>", "</html>", ""];
  if (!result) {
    return [...head, `<p>This run recorded no measurements${run.failure ? ` (failure: ${escapeHtml(run.failure.category)})` : ""}.</p>`, requestsSection(run, undefined), setupSection(run, undefined), chainsSection(run, undefined), ...foot].join("\n");
  }
  return [
    ...head,
    tiles(result),
    '<div class="cols">',
    thresholdCard(run, result),
    findingsCard(result),
    "</div>",
    chartsSection(run, result, results),
    requestsSection(run, result),
    chainsSection(run, result),
    setupSection(run, result),
    dataSetSection(run, result),
    writesSection(run, result),
    ...foot,
  ].join("\n");
}
