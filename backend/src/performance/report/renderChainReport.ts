import type { ChainRun, ChainRunSnapshotStep, PerformanceResult, StepResult } from "@apipilot/shared-domain";
import { bytes, clock, escapeHtml, formatCount, ms, pct, phaseTable, REPORT_CSP, STYLE, timelineSvg, timelineTable } from "./renderHtmlReport";

/**
 * The self-contained report of a request-chain run (specs/037-request-chain-performance research
 * R20; FR-033, FR-034, FR-046). It reuses the legacy report's styles and charts, and is built only
 * from the stored run: the snapshot (structure and provenance) and the measured result. It never
 * contains request or response content: a step is named by its name, method and URL template, a check
 * by its kind and path, and nothing a run sent or received is recorded. The legacy
 * `renderHtmlReport` is untouched, so reports of earlier runs render as before (FR-037).
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

function stepLabel(step: ChainRunSnapshotStep): string {
  return `${escapeHtml(step.name)} <span class="small"><span class="method">${escapeHtml(step.method)}</span> <code>${escapeHtml(step.pathTemplate)}</code></span>`;
}

function statusText(status: string): string {
  return status === "0" ? "No response" : status;
}

function stepBlock(step: ChainRunSnapshotStep, measured: StepResult | undefined, cutShortHere: number): string {
  const received = measured?.statusesReceived?.map((entry) => `${statusText(entry.status)} × ${formatCount(entry.count)}`).join(", ") ?? "";
  const glance = measured && measured.requests > 0 ? `${received ? `${received} · ` : ""}p95 ${ms(measured.latencyMs?.p95)} · ${pct(measured.errorRatePercent)} failed` : "not sent";
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
    `<details${measured && measured.errorRatePercent > 0 ? " open" : ""}>`,
    `<summary>${stepLabel(step)} <span class="glance${measured && measured.errorRatePercent > 0 ? " fail-text" : ""}">${escapeHtml(glance)}</span></summary>`,
    '<dl class="why">',
    `<dt>Source</dt><dd>${escapeHtml(sourceText(step))}</dd>`,
    `<dt>Runs</dt><dd>${escapeHtml(RUNS_TEXT[step.runs])}</dd>`,
    `<dt>Expected</dt><dd>${escapeHtml(step.expectedStatuses.join(", ") || "—")}</dd>`,
    `<dt>Extractors</dt><dd>${extractors ? `<ul>${extractors}</ul>` : "None"}</dd>`,
    `<dt>Checks</dt><dd>${checks ? `<ul>${checks}</ul>` : "None"}</dd>`,
    cutShortHere > 0 ? `<dt>Cut short here</dt><dd>${formatCount(cutShortHere)} times</dd>` : "",
    notSent > 0 ? `<dt>Not sent</dt><dd>${formatCount(measured!.notAttempted.missingData)} missing data · ${formatCount(measured!.notAttempted.dependencyNotAttempted)} not attempted</dd>` : "",
    measured?.missingVariables.length ? `<dt>Missing values</dt><dd>${escapeHtml(measured.missingVariables.join(", "))}</dd>` : "",
    measured ? phaseTable(measured) : "",
    "</dl>",
    "</details>",
  ].join("");
}

function tiles(result: PerformanceResult): string {
  const t = result.totals;
  const tile = (key: string, value: string, note = "") => `<div class="tile"><div class="k">${key}</div><div class="v">${value}</div>${note ? `<div class="small muted">${note}</div>` : ""}</div>`;
  return [
    '<div class="tiles">',
    tile("Requests", formatCount(t.requests), "Once before load steps not included"),
    tile("Throughput", `${formatCount(t.throughputPerSecond)}/s`),
    tile("Failure rate", pct(t.errorRatePercent), `${formatCount(t.errors)} failures`),
    tile("p50 latency", ms(t.latencyMs?.p50)),
    tile("p95 latency", ms(t.latencyMs?.p95)),
    tile("p99 latency", ms(t.latencyMs?.p99)),
    tile("Iterations", formatCount(t.iterations), t.iterationDurationMs ? `p95 ${ms(t.iterationDurationMs.p95)} each` : ""),
    tile("Chains cut short", formatCount(t.journeysCutShort)),
    t.dataReceivedBytes !== undefined ? tile("Data received", bytes(t.dataReceivedBytes), `${bytes(t.dataSentBytes ?? 0)} sent`) : "",
    "</div>",
  ].join("");
}

function thresholdSection(run: ChainRun, result: PerformanceResult): string {
  const thresholds = run.snapshot.thresholds;
  if (thresholds.length === 0) return "<p>No thresholds were set, so the report gives no pass/fail verdict.</p>";
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
  return `<table><thead><tr><th>Threshold</th><th class="num">Measured</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function setupSection(run: ChainRun, result: PerformanceResult | undefined): string {
  const setupSteps = run.snapshot.chains.flatMap((chain) => chain.steps.filter((step) => step.runs === "once-before-load"));
  if (setupSteps.length === 0) return "";
  const outcomes = new Map((result?.setupSteps ?? []).map((entry) => [entry.stepId, entry]));
  const refreshes = new Map((result?.tokenRefreshes.bySetupStep ?? []).map((entry) => [entry.stepId, entry]));
  const rows = setupSteps
    .map((step) => {
      const outcome = outcomes.get(step.id);
      const verdict = !outcome ? '<span class="badge neutral">Not sent</span>' : outcome.outcome === "ok" ? '<span class="badge ok">OK</span>' : `<span class="badge bad">Failed</span> ${escapeHtml(setupReason(outcome.reason))}`;
      const refresh = refreshes.get(step.id);
      return `<tr><td>${stepLabel(step)}</td><td>${verdict}</td><td class="num">${ms(outcome?.latencyMs ?? null)}</td><td class="num">${refresh ? `${formatCount(refresh.refreshed)} · ${formatCount(refresh.failed)} failed` : "—"}</td></tr>`;
    })
    .join("");
  return [
    "<h2>Once before load</h2>",
    '<p class="small muted">Sent once before any virtual user started; never counted in the load\'s requests or latency. A step whose response stated <code>expires_in</code> was sent again by each virtual user before it expired.</p>',
    `<table><thead><tr><th>Step</th><th>Outcome</th><th class="num">Latency</th><th class="num">Refreshes</th></tr></thead><tbody>${rows}</tbody></table>`,
    result && !result.tokenRefreshes.lifetimeStated ? "<p>A Once before load response stated no lifetime, so its values were never refreshed.</p>" : "",
    result && result.tokenRefreshes.bucketOffsetsMs.length > 0 ? `<p class="small muted">Refreshes at ${result.tokenRefreshes.bucketOffsetsMs.map(clock).join(", ")}.</p>` : "",
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
    "<h2>Data sets</h2>",
    '<p class="small muted">Rows were taken in file order and wrapped to the first row when they ran out. No data set value is recorded.</p>',
    `<div class="scroll"><table><thead><tr><th>Data set</th><th>Mode</th><th>Columns</th><th class="num">Rows</th><th class="num">Rows used</th><th>Wrapped</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  ].join("");
}

/** Renders the report from a stored chain run. Deterministic for the same run record. */
export function renderChainReport(run: ChainRun): string {
  const snapshot = run.snapshot;
  const result = run.result;
  const profile = snapshot.loadProfile.stages.map((stage) => `${Math.round(stage.durationMs / 1000)} s → ${stage.targetVirtualUsers}`).join(", ");
  const head = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>ApiPilot performance report · run ${escapeHtml(run.id.slice(0, 8))}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    `<h1>Performance report · ${escapeHtml(snapshot.planName)} ${statusBadge(run)}</h1>`,
    `<p class="muted small">Request-chain plan, run ${escapeHtml(run.id.slice(0, 8))}. ${CHAIN_CONTENT_NOTICE} No request or response content, extracted value or data set value is recorded.</p>`,
    '<dl class="meta">',
    `<div><dt>Environment</dt><dd>${escapeHtml(run.environment.name)} <span class="badge neutral">Tier: ${escapeHtml(run.environment.tier)}</span></dd><dd><code>${escapeHtml(run.environment.baseUrl)}</code></dd></div>`,
    `<div><dt>Load profile</dt><dd>${escapeHtml(snapshot.loadProfile.kind)} · ${escapeHtml(profile)}</dd><dd class="small muted">Default think time ${snapshot.thinkTimeMs / 1000} s</dd></div>`,
    `<div><dt>Started · ended</dt><dd><code>${escapeHtml(run.startedAt)}</code></dd><dd><code>${escapeHtml(run.endedAt ?? "—")}</code></dd></div>`,
    `<div><dt>k6 · script</dt><dd><code>v${escapeHtml(run.k6Version)} · sha256 ${escapeHtml(run.scriptSha256.slice(0, 12))}</code></dd></div>`,
    `<div><dt>Hosts</dt><dd>${snapshot.hosts.map((host) => `<code>${escapeHtml(host)}</code>`).join(", ") || "—"}</dd></div>`,
    `<div><dt>Seeded from</dt><dd>${escapeHtml(snapshot.seedSource ? (snapshot.seedSource.kind === "collection" ? `Collection ${snapshot.seedSource.collectionName}` : snapshot.seedSource.kind === "specification" ? `Specification ${snapshot.seedSource.filename}` : "The guided workflow") : "Built by the engineer")}</dd></div>`,
    "</dl>",
  ];
  const results = new Map((result?.steps ?? []).map((step) => [step.stepId, step]));
  const journeyResults = new Map((result?.journeys ?? []).map((journey) => [journey.journeyId, journey]));
  const chainsSection = [
    "<h2>Chains</h2>",
    ...snapshot.chains.map((chain) => {
      const journey = journeyResults.get(chain.id);
      const iterationSteps = chain.steps.filter((step) => step.runs !== "once-before-load");
      const cutByExtractor = journey?.cutShortByCapture ? Object.entries(journey.cutShortByCapture).map(([name, count]) => `${name === "" ? "an unexpected status" : name} × ${formatCount(count)}`).join(", ") : "";
      const summary = journey
        ? `${formatCount(journey.requests)} requests · ${pct(journey.errorRatePercent)} failed · p95 ${ms(journey.latencyMs?.p95)} · cut short ${formatCount(journey.runsCutShort)}${cutByExtractor ? ` (${escapeHtml(cutByExtractor)})` : ""}`
        : iterationSteps.length === 0
          ? "No step runs in the load"
          : "Not run";
      return [
        `<h3>${escapeHtml(chain.name)} <span class="small muted">${summary}</span></h3>`,
        ...iterationSteps.map((step) => stepBlock(step, results.get(step.id), journey?.cutShortAtStepId === step.id ? journey.runsCutShort : 0)),
      ].join("");
    }),
  ].join("");
  if (!result) {
    return [...head, `<p>This run recorded no measurements${run.failure ? ` (failure: ${escapeHtml(run.failure.category)})` : ""}.</p>`, setupSection(run, undefined), chainsSection, "</body>", "</html>", ""].join("\n");
  }
  const { points, bucketMs } = result.timeline;
  const body = [
    tiles(result),
    "<h2>Thresholds</h2>",
    thresholdSection(run, result),
    "<h2>Findings</h2>",
    result.findings.length === 0 ? "<p>No rule produced a finding for this run.</p>" : `<ol class="findings">${result.findings.map((finding) => `<li>${escapeHtml(finding.message)}</li>`).join("")}</ol>`,
    setupSection(run, result),
    "<h2>Timeline</h2>",
    timelineSvg(points, bucketMs),
    timelineTable(points, bucketMs),
    chainsSection,
    '<p class="small muted">A response is a failure only when its status is not among the step\'s expected statuses, or when there is no response. Failed checks and failed extractions are counted on their own and are not in the failure rate.</p>',
    "<h2>What the run changed on the target</h2>",
    snapshot.writeSummary.total === 0
      ? "<p>The plan sends no write requests.</p>"
      : `<table><thead><tr><th>Write step</th><th class="num">Sent</th><th class="num">Succeeded</th></tr></thead><tbody>${result.writeRequests
          .map((entry) => {
            const step = snapshot.chains.flatMap((chain) => chain.steps).find((candidate) => candidate.id === entry.operationKey);
            return `<tr><td>${step ? stepLabel(step) : escapeHtml(entry.operationKey)}</td><td class="num">${formatCount(entry.sent)}</td><td class="num">${formatCount(entry.succeeded)}</td></tr>`;
          })
          .join("")}</tbody></table><p class="small muted">ApiPilot does not clean up anything a run creates.</p>`,
    dataSetSection(run, result),
  ];
  return [...head, ...body, "</body>", "</html>", ""].join("\n");
}
