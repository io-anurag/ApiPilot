import type { PerformancePlan, PerformanceResult, PerformanceRun, PerformanceStep, TimelinePoint } from "@apipilot/shared-domain";

/**
 * The self-contained performance report (FR-035 to FR-040; specs/031-k6-performance-testing
 * research D17). One deterministic HTML document from the stored run: inline CSS with light and
 * dark styles, server-computed inline SVG, no JavaScript, and a Content-Security-Policy that lets
 * it load nothing. Every string is HTML-escaped, because path templates come from an uploaded
 * specification. Steps are identified by method and path template only; no value, token or body
 * is ever part of a run record, so none can appear here (FR-040).
 */
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Locale-free number formatting, so the same run renders the same bytes on every machine. */
export function formatCount(value: number): string {
  const [whole, fraction] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatCount(Math.round(value * 10) / 10)} ms`;
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value}%`;
}

function clock(offsetMs: number): string {
  const total = Math.floor(offsetMs / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const CHOICE_TEXT: Record<PerformanceStep["scenarioChoice"], string> = {
  "rule-generated": "rule-generated, preferred over AI-enhanced alternatives",
  "only-positive": "the operation's only positive scenario",
  "ai-enhanced-no-rule-alternative": "AI-enhanced; no rule-generated positive scenario exists",
};

const AUTH_TEXT: Record<PerformanceStep["auth"]["kind"], string> = {
  "oauth2-client-credentials": "OAuth2 client credentials",
  "chained-login": "Token from a login request",
  "static-credential": "Credential from the environment",
  none: "None",
};

function statusBadge(run: PerformanceRun): string {
  const labels: Record<PerformanceRun["status"], string> = {
    "in-progress": "In progress",
    completed: "Completed",
    cancelled: run.cancelReason === "backend-restart" ? "Cancelled · backend restart" : "Cancelled · by you",
    failed: `Failed · ${run.failure?.category ?? "unknown"}`,
  };
  const tone = run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "neutral";
  return `<span class="badge ${tone}">${escapeHtml(labels[run.status])}</span>`;
}

function timelineSvg(points: TimelinePoint[], bucketMs: number): string {
  if (points.length === 0) return '<p class="muted">No timeline was recorded.</p>';
  const width = 1200;
  const height = 220;
  const left = 56;
  const right = 72;
  const top = 16;
  const bottom = 180;
  const lastOffset = points[points.length - 1].offsetMs + bucketMs;
  const x = (offset: number) => left + ((width - left - right) * offset) / Math.max(bucketMs, lastOffset);
  const maxVus = Math.max(1, ...points.map((p) => p.virtualUsers));
  const maxP95 = Math.max(1, ...points.map((p) => p.p95Ms ?? 0));
  const maxErrors = Math.max(1, ...points.map((p) => p.errors));
  const yVus = (v: number) => bottom - ((bottom - top) * v) / maxVus;
  const yP95 = (v: number) => bottom - ((bottom - top) * v) / maxP95;
  const round = (v: number) => Math.round(v * 10) / 10;
  const vusLine = points.map((p) => `${round(x(p.offsetMs))},${round(yVus(p.virtualUsers))}`).join(" ");
  const area = `${round(x(points[0].offsetMs))},${bottom} ${vusLine} ${round(x(points[points.length - 1].offsetMs))},${bottom}`;
  const p95Line = points
    .filter((p) => p.p95Ms !== null)
    .map((p) => `${round(x(p.offsetMs))},${round(yP95(p.p95Ms!))}`)
    .join(" ");
  const barWidth = Math.max(2, round((width - left - right) / Math.max(1, lastOffset / bucketMs) - 2));
  const bars = points
    .filter((p) => p.errors > 0)
    .map((p) => {
      const h = round(Math.max(2, (40 * p.errors) / maxErrors));
      return `<rect class="err" x="${round(x(p.offsetMs))}" y="${round(bottom - h)}" width="${barWidth}" height="${h}"></rect>`;
    })
    .join("");
  const summary = `Virtual users peak at ${maxVus}; p95 latency peaks at ${formatCount(round(maxP95))} ms; ${points.filter((p) => p.errors > 0).length} of ${points.length} time buckets have failures.`;
  return [
    `<svg viewBox="0 0 ${width} ${height + 24}" role="img" aria-label="${escapeHtml(summary)}">`,
    `<line class="grid" x1="${left}" y1="${bottom}" x2="${width - right}" y2="${bottom}"></line>`,
    `<line class="grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>`,
    `<polygon class="vus-area" points="${area}"></polygon>`,
    `<polyline class="vus-line" points="${vusLine}"></polyline>`,
    p95Line ? `<polyline class="p95" points="${p95Line}"></polyline>` : "",
    bars,
    `<text class="axis" x="${left - 8}" y="${top + 4}" text-anchor="end">${maxVus} VUs</text>`,
    `<text class="axis" x="${left - 8}" y="${bottom + 4}" text-anchor="end">0</text>`,
    `<text class="axis" x="${width - right + 8}" y="${top + 4}">${escapeHtml(formatCount(round(maxP95)))} ms</text>`,
    `<text class="axis" x="${left}" y="${bottom + 18}">00:00</text>`,
    `<text class="axis" x="${width - right}" y="${bottom + 18}" text-anchor="end">${clock(lastOffset)}</text>`,
    `<text class="axis" x="${(width - left - right) / 2 + left}" y="${height + 18}" text-anchor="middle">Elapsed time · ${clock(bucketMs)} buckets</text>`,
    "</svg>",
  ].join("");
}

function stepRows(plan: PerformancePlan, result: PerformanceResult): string {
  const byId = new Map(result.steps.map((step) => [step.stepId, step]));
  return plan.journeys
    .flatMap((journey, journeyIndex) =>
      journey.steps.map((step, stepIndex) => {
        const measured = byId.get(step.id);
        const failures = measured?.errorsByStatus.map((entry) => `${entry.status} × ${formatCount(entry.count)}`).join(", ");
        const categories = measured?.errorsByCategory.map((entry) => `${entry.category} × ${formatCount(entry.count)}`).join(", ");
        const notSent = [
          measured && measured.notAttempted.missingData > 0
            ? `Missing data (${escapeHtml(measured.missingVariables.join(", "))}) × ${formatCount(measured.notAttempted.missingData)}`
            : "",
          measured && measured.notAttempted.dependencyNotAttempted > 0 ? `Dependency not attempted × ${formatCount(measured.notAttempted.dependencyNotAttempted)}` : "",
        ]
          .filter(Boolean)
          .join("<br>");
        const edited = step.bodyEdited ? " · " + BODY_EDITED_MARKER : "";
        return [
          "<tr>",
          `<td><span class="method">${escapeHtml(step.method)}</span> <code>${escapeHtml(step.path)}</code><div class="muted small">J${journeyIndex + 1} · step ${stepIndex + 1}${edited}</div></td>`,
          `<td><code>${escapeHtml(step.expectedStatuses.map((status) => status.code).join(", "))}</code></td>`,
          `<td class="num">${formatCount(measured?.requests ?? 0)}</td>`,
          `<td class="num">${ms(measured?.latencyMs?.p50)}</td>`,
          `<td class="num">${ms(measured?.latencyMs?.p90)}</td>`,
          `<td class="num">${ms(measured?.latencyMs?.p95)}</td>`,
          `<td class="num">${ms(measured?.latencyMs?.p99)}</td>`,
          `<td class="num">${measured && measured.requests > 0 ? formatCount(measured.throughputPerSecond) : "—"}</td>`,
          `<td class="num">${measured && measured.requests > 0 ? pct(measured.errorRatePercent) : "—"}</td>`,
          `<td class="small">${escapeHtml([failures, categories].filter(Boolean).join(" · ") || "—")}</td>`,
          `<td class="num">${pct(measured?.checkPassRatePercent ?? null)}</td>`,
          `<td class="small">${notSent || "—"}</td>`,
          "</tr>",
        ].join("");
      }),
    )
    .join("");
}

function provenance(plan: PerformancePlan): string {
  const stepsById = new Map(plan.journeys.flatMap((journey) => journey.steps.map((step) => [step.id, step])));
  return plan.journeys
    .flatMap((journey, journeyIndex) =>
      journey.steps.map((step, stepIndex) => {
        const why = step.dependency
          ? `${step.produces.length > 0 ? `Produces ${step.produces.join(", ")}` : `Consumes ${step.consumes.join(", ")}`} · relationships ${step.dependency.relationshipIds.map((id) => id.slice(0, 12)).join(", ")} (${step.dependency.confidence})`
          : "A single operation in scope";
        const variables =
          step.variableBindings.length === 0
            ? "None"
            : step.variableBindings
                .map((binding) =>
                  binding.role === "produces"
                    ? `${binding.variable} ← response field ${binding.field}`
                    : `${binding.variable} → ${binding.location} ${binding.field}, from ${stepsById.get(binding.producerStepId ?? "")?.operationKey ?? "an earlier step"}`,
                )
                .join("; ");
        const statuses = step.expectedStatuses.map((status) => `${status.code} (${status.source === "specification" ? "from specification" : "set by you"})`).join(", ");
        return [
          `<details${journeyIndex === 0 && stepIndex === 0 ? " open" : ""}>`,
          `<summary><span class="method">${escapeHtml(step.method)}</span> <code>${escapeHtml(step.path)}</code> <span class="muted">J${journeyIndex + 1} · step ${stepIndex + 1}</span></summary>`,
          "<dl>",
          `<dt>Why in this journey</dt><dd>${escapeHtml(why)}</dd>`,
          `<dt>Scenario</dt><dd>${escapeHtml(step.scenarioDescription)} · ${escapeHtml(CHOICE_TEXT[step.scenarioChoice])}${step.tieBrokenByLowestId ? " (lowest id among equals)" : ""}</dd>`,
          `<dt>Variables</dt><dd>${escapeHtml(variables)}</dd>`,
          `<dt>Authentication</dt><dd>${escapeHtml(AUTH_TEXT[step.auth.kind])}${step.auth.schemeName ? ` (${escapeHtml(step.auth.schemeName)})` : ""}</dd>`,
          `<dt>Expected status</dt><dd>${escapeHtml(statuses || "None")}</dd>`,
          "</dl>",
          "</details>",
        ].join("");
      }),
    )
    .join("");
}

function thresholdRows(run: PerformanceRun, result: PerformanceResult): string {
  const plan = run.planSnapshot;
  if (plan.thresholds.length === 0) return '<p>No thresholds were set, so the report gives no pass/fail verdict.</p>';
  const outcomes = new Map(result.thresholdOutcomes.map((outcome) => [outcome.thresholdId, outcome]));
  const operationKey = (stepId: string) => plan.journeys.flatMap((j) => j.steps).find((s) => s.id === stepId)?.operationKey ?? stepId;
  const failed = result.thresholdOutcomes.filter((outcome) => !outcome.passed).length;
  const rows = plan.thresholds
    .map((threshold) => {
      const outcome = outcomes.get(threshold.id);
      const where = threshold.scope.kind === "run" ? "Run" : operationKey(threshold.scope.stepId);
      const unit = threshold.metric === "error-rate" ? "%" : " ms";
      const label = `${where} ${threshold.metric === "error-rate" ? "failure rate" : threshold.metric} ≤ ${threshold.limit}${unit}`;
      const measured = outcome?.measured === null || outcome?.measured === undefined ? "—" : `${formatCount(outcome.measured)}${unit}`;
      const verdict = outcome?.passed ? '<span class="badge ok">Passed</span>' : '<span class="badge bad">Failed</span>';
      return `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(measured)}</td><td>${verdict}</td></tr>`;
    })
    .join("");
  return `<p>${failed} of ${plan.thresholds.length} failed. Set by you before the run; ApiPilot proposes no targets.</p><table><thead><tr><th>Threshold</th><th class="num">Measured</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STYLE = `
:root{--bg:#ffffff;--fg:#17231f;--muted:#56675f;--border:#d8e4df;--chrome:#f7faf8;--ok-bg:#dcfce7;--ok-fg:#15803d;--bad-bg:#fee2e2;--bad-fg:#b91c1c;--neutral-bg:#eef2f0;--neutral-fg:#334155;--vus:#aceed9;--vus-line:#078366;--p95:#c2410c;--err:#b91c1c}
@media (prefers-color-scheme: dark){:root{--bg:#121d1a;--fg:#e4efeb;--muted:#95aaa2;--border:#263b35;--chrome:#0c1714;--ok-bg:rgba(34,197,94,.16);--ok-fg:#dcfce7;--bad-bg:rgba(239,68,68,.16);--bad-fg:#fee2e2;--neutral-bg:rgba(100,116,139,.18);--neutral-fg:#f1f5f9;--vus:rgba(53,197,162,.25);--vus-line:#35c5a2;--p95:#fb923c;--err:#f87171}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.45 "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}code,.method,.num{font-family:"JetBrains Mono","Cascadia Code",Consolas,monospace}
.muted{color:var(--muted)}.small{font-size:12px}.num{text-align:right;white-space:nowrap}
.badge{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600}.ok{background:var(--ok-bg);color:var(--ok-fg)}.bad{background:var(--bad-bg);color:var(--bad-fg)}.neutral{background:var(--neutral-bg);color:var(--neutral-fg)}
.method{font-weight:600;font-size:12px}
.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 24px;margin:16px 0}.meta dt{font-size:12px;font-weight:600;color:var(--muted)}.meta dd{margin:0}
.tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.tile{border:1px solid var(--border);border-radius:8px;background:var(--chrome);padding:12px 14px}.tile .k{font-size:12px;font-weight:600;color:var(--muted)}.tile .v{font:600 20px "JetBrains Mono",Consolas,monospace}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:12px;color:var(--muted);background:var(--chrome);padding:7px 9px;border-bottom:1px solid var(--border)}td{padding:8px 9px;border-bottom:1px solid var(--border);vertical-align:top}
.scroll{overflow-x:auto}svg{width:100%;height:auto;display:block}.grid{stroke:var(--border)}.vus-area{fill:var(--vus)}.vus-line{fill:none;stroke:var(--vus-line);stroke-width:2}.p95{fill:none;stroke:var(--p95);stroke-width:2.5}.err{fill:var(--err)}.axis{fill:var(--muted);font:11px "JetBrains Mono",Consolas,monospace}
.legend{display:flex;gap:18px;font-size:12px;margin:0 0 6px}.swatch{display:inline-block;width:14px;height:10px;margin-right:6px;vertical-align:middle}
ol.findings{padding-left:20px;margin:0}ol.findings li{margin:6px 0}
details{border-top:1px solid var(--border);padding:8px 0}summary{cursor:pointer}dl.prov{display:grid;grid-template-columns:180px minmax(0,1fr);gap:4px 16px;margin:8px 0 0 20px}
details dl{display:grid;grid-template-columns:180px minmax(0,1fr);gap:4px 16px;margin:8px 0 0 20px}details dt{color:var(--muted);font-size:12px;font-weight:600}details dd{margin:0}
@media (max-width:760px){.meta,.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

/** Renders the report from a stored run. Deterministic for the same run record. */
export function renderHtmlReport(run: PerformanceRun): string {
  const plan = run.planSnapshot;
  const result = run.result;
  const profile = plan.loadProfile.stages.map((stage) => `${Math.round(stage.durationMs / 1000)} s → ${stage.targetVirtualUsers}`).join(", ");
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
    `<h1>Performance report · run ${escapeHtml(run.id.slice(0, 8))} ${statusBadge(run)}</h1>`,
    '<p class="muted small">Generated by ApiPilot from the stored run. Latency percentiles are within 1%. No request or response bodies, tokens or resolved URLs are recorded.</p>',
    '<dl class="meta">',
    `<div><dt>Environment</dt><dd>${escapeHtml(run.environment.name)} <span class="badge neutral">Tier: ${escapeHtml(run.environment.tier)}</span></dd><dd><code>${escapeHtml(run.environment.baseUrl)}</code></dd></div>`,
    `<div><dt>Load profile</dt><dd>${escapeHtml(plan.loadProfile.kind)} · ${escapeHtml(profile)}</dd><dd class="small muted">Think time ${plan.thinkTimeMs / 1000} s</dd></div>`,
    `<div><dt>Started · ended</dt><dd><code>${escapeHtml(run.startedAt)}</code></dd><dd><code>${escapeHtml(run.endedAt ?? "—")}</code></dd></div>`,
    `<div><dt>k6 · script</dt><dd><code>v${escapeHtml(run.k6Version)} · sha256 ${escapeHtml(run.scriptSha256.slice(0, 12))}</code></dd></div>`,
    "</dl>",
  ];
  if (!result) {
    return [...head, `<p>This run recorded no measurements${run.failure ? ` (failure: ${escapeHtml(run.failure.category)})` : ""}.</p>`, provenanceSection(plan), "</body>", "</html>", ""].join("\n");
  }
  const t = result.totals;
  const body = [
    '<div class="tiles">',
    `<div class="tile"><div class="k">Requests</div><div class="v">${formatCount(t.requests)}</div></div>`,
    `<div class="tile"><div class="k">Throughput</div><div class="v">${formatCount(t.throughputPerSecond)}/s</div></div>`,
    `<div class="tile"><div class="k">Failure rate</div><div class="v">${pct(t.errorRatePercent)}</div><div class="small muted">${formatCount(t.errors)} failures</div></div>`,
    `<div class="tile"><div class="k">p95 latency</div><div class="v">${ms(t.latencyMs?.p95)}</div></div>`,
    `<div class="tile"><div class="k">Iterations</div><div class="v">${formatCount(t.iterations)}</div></div>`,
    `<div class="tile"><div class="k">Journeys cut short</div><div class="v">${formatCount(t.journeysCutShort)}</div></div>`,
    "</div>",
    "<h2>Thresholds</h2>",
    thresholdRows(run, result),
    "<h2>Findings</h2>",
    result.findings.length === 0 ? "<p>No rule produced a finding for this run.</p>" : `<ol class="findings">${result.findings.map((finding) => `<li>${escapeHtml(finding.message)}</li>`).join("")}</ol>`,
    "<h2>Timeline</h2>",
    '<div class="legend"><span><span class="swatch" style="background:var(--vus)"></span>Virtual users</span><span><span class="swatch" style="background:var(--p95)"></span>p95 latency</span><span><span class="swatch" style="background:var(--err)"></span>Failures per bucket</span></div>',
    timelineSvg(result.timeline.points, result.timeline.bucketMs),
    "<h2>By step</h2>",
    '<div class="scroll"><table><thead><tr><th>Step</th><th>Expected</th><th class="num">Requests</th><th class="num">p50</th><th class="num">p90</th><th class="num">p95</th><th class="num">p99</th><th class="num">Req/s</th><th class="num">Failure rate</th><th>Failures by status · category</th><th class="num">Checks passed</th><th>Not sent</th></tr></thead>',
    `<tbody>${stepRows(plan, result)}</tbody></table></div>`,
    '<p class="small muted">A response is a failure only when its status is not among the step\'s expected codes, or when there is no response. Failed extractions are listed but not counted in the failure rate. Token requests are not counted in any step.</p>',
    "<h2>What the run changed on the target</h2>",
    result.writeRequests.length === 0
      ? "<p>No write requests were sent.</p>"
      : `<table><thead><tr><th>Write operation</th><th class="num">Sent</th><th class="num">Succeeded</th></tr></thead><tbody>${result.writeRequests.map((entry) => `<tr><td><span class="method">${escapeHtml(entry.method)}</span> <code>${escapeHtml(entry.operationKey.slice(entry.operationKey.indexOf(" ") + 1))}</code></td><td class="num">${formatCount(entry.sent)}</td><td class="num">${formatCount(entry.succeeded)}</td></tr>`).join("")}</tbody></table><p class="small muted">ApiPilot does not clean up anything a run creates.</p>`,
    "<h2>Token refreshes</h2>",
    `<p>${formatCount(result.tokenRefreshes.count)} refreshes, ${formatCount(result.tokenRefreshes.failed)} failed. ${result.tokenRefreshes.lifetimeStated ? "Each virtual user refreshed its own token before its stated lifetime ended." : "A token had no stated lifetime, so it was not refreshed."}${result.tokenRefreshes.bucketOffsetsMs.length > 0 ? ` Refreshes at ${result.tokenRefreshes.bucketOffsetsMs.map(clock).join(", ")}.` : ""}</p>`,
    provenanceSection(plan),
  ];
  return [...head, ...body, "</body>", "</html>", ""].join("\n");
}

/** AP-032 FR-013: a quick plan's report says its scenarios were generated and never reviewed. */
export const QUICK_PLAN_PROVENANCE = "Plan built by the quick performance test from generated positive scenarios that were not reviewed.";

/** AP-033 FR-014: the marker on a step that sent an engineer-written body. The body itself is never recorded. */
export const BODY_EDITED_MARKER = "Body edited by you";

/** AP-033 FR-014 (constitution XI, XIII): how many steps sent a body the engineer wrote. */
export function bodyEditProvenance(count: number): string {
  const steps = count === 1 ? "1 step" : `${count} steps`;
  return `${steps} sent a body written by the engineer, not generated from the specification.`;
}

function provenanceSection(plan: PerformancePlan): string {
  // A snapshot recorded before AP-032 has no `source`; it came from the guided workflow.
  const quick = plan.source === "quick" ? `<p>${escapeHtml(QUICK_PLAN_PROVENANCE)}</p>` : "";
  const editedCount = plan.journeys.reduce((total, journey) => total + journey.steps.filter((step) => step.bodyEdited).length, 0);
  const edited = editedCount > 0 ? `<p>${escapeHtml(bodyEditProvenance(editedCount))}</p>` : "";
  return `<h2>Provenance</h2>${quick}${edited}${provenance(plan)}`;
}
