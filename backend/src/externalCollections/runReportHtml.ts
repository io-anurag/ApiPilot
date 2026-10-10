import {
  REASON_EXPLANATION,
  REPORT_METHOD_COLOURS,
  buildRunInsights,
  formatReportTime,
  type RunReportModel,
  type RunReportRow,
} from "./runReport";
import { NO_REQUESTS_NOTE, buildSeriesChart, layoutSeriesChart } from "./runSeriesChart";

/** Every piece of text from the run (names, messages) is untrusted: it comes from an uploaded file. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;

const METHOD_CLASS: Record<string, string> = {
  GET: "m-get",
  POST: "m-post",
  PUT: "m-put",
  PATCH: "m-patch",
  DELETE: "m-delete",
  HEAD: "m-head",
  OPTIONS: "m-options",
};

const OUTCOME_CLASS: Record<RunReportRow["outcome"], string> = {
  Passed: "o-pass",
  Failed: "o-fail",
  "Not attempted": "o-skip",
};

function methodBadge(method: string): string {
  return `<span class="method ${METHOD_CLASS[method] ?? "m-other"}">${e(method)}</span>`;
}

function outcomeBadge(row: RunReportRow): string {
  return `<span class="outcome ${OUTCOME_CLASS[row.outcome]}">${e(row.outcome)}</span>`;
}

function duration(row: RunReportRow): string {
  return row.outcome === "Not attempted" ? "-" : `${row.durationMs} ms`;
}

/** One rule per method, from the colours shared with the PDF. */
const METHOD_CSS = Object.entries(REPORT_METHOD_COLOURS)
  .map(([method, colour]) => `.m-${method.toLowerCase()}{background:${colour.fill};color:${colour.text}}`)
  .join("");

const STYLE = `
:root{--bg:#f6f8fb;--surface:#fff;--subtle:#f8fafc;--strong:#eaeff5;--border:#e1e7ef;--text:#0f172a;--muted:#475569;--accent:#0e6a8a;
--pass:#15803d;--fail:#dc2626;--skip:#64748b;--warn:#b45309;--mono:ui-monospace,SFMono-Regular,Consolas,monospace}
:root[data-theme=dark]{--bg:#090b10;--surface:#11151c;--subtle:#161b23;--strong:#202631;--border:#262d39;--text:#f3f6fa;--muted:#aab4c4;--accent:#4cb6d6;
--pass:#22c55e;--fail:#f87171;--skip:#94a3b8;--warn:#fbbf24}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#090b10;--surface:#11151c;--subtle:#161b23;--strong:#202631;--border:#262d39;--text:#f3f6fa;--muted:#aab4c4;--accent:#4cb6d6;--pass:#22c55e;--fail:#f87171;--skip:#94a3b8;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:20px 16px 48px}
header.top{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:16px}
.eyebrow{font:600 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:24px;margin:2px 0 6px}h2{font-size:15px;margin:0 0 10px}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-block;border:1px solid var(--border);background:var(--strong);border-radius:999px;padding:1px 10px;font-size:12px;font-weight:600}
.chip.status-completed{border-color:var(--pass)}.chip.status-cancelled{border-color:var(--warn)}
button{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer}
button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px}
.tile .label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.tile .value{font-size:26px;font-weight:700;line-height:1.2}
.tile.pass .value{color:var(--pass)}.tile.fail .value{color:var(--fail)}
.strip{display:flex;gap:2px;flex-wrap:wrap;margin:6px 0 4px}
.cell{width:14px;height:22px;border-radius:3px;background:var(--skip)}.cell.p{background:var(--pass)}.cell.f{background:var(--fail)}
.legend{font-size:12px;color:var(--muted)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid var(--border)}
td{padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:top}tr:last-child td{border-bottom:0}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono);font-size:12px}
.method{justify-self:start;display:inline-block;min-width:3.4em;text-align:center;border-radius:4px;padding:0 6px;font:700 11px var(--mono);color:#fff}
${METHOD_CSS}.m-other{background:var(--strong);color:var(--text)}
.outcome{font-weight:700;font-size:12px}.o-pass{color:var(--pass)}.o-fail{color:var(--fail)}.o-skip{color:var(--skip)}
.bar{height:8px;border-radius:4px;background:var(--strong);overflow:hidden;min-width:60px}.bar>span{display:block;height:100%;background:var(--accent)}
.cluster{border-left:3px solid var(--fail);padding:4px 0 4px 10px;margin-bottom:10px}
.cluster .why{font-size:12px;color:var(--muted)}
.muted{color:var(--muted)}.empty{color:var(--muted);font-style:italic}
details.row{border-bottom:1px solid var(--border)}details.row:last-child{border-bottom:0}
details.row>summary{display:grid;grid-template-columns:2rem 4.5rem minmax(0,1fr) 7rem 3.5rem 5rem;gap:8px;align-items:center;padding:8px 4px;cursor:pointer;list-style:none}
details.row>summary::-webkit-details-marker{display:none}
details.row[open]>summary{background:var(--subtle)}
.detail{padding:8px 12px 12px 3rem;font-size:13px;background:var(--subtle)}
.detail ul{margin:4px 0 0;padding-left:18px}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.colhead span:nth-child(5),.colhead span:nth-child(6){text-align:right}
.colhead{display:grid;grid-template-columns:2rem 4.5rem minmax(0,1fr) 7rem 3.5rem 5rem;gap:8px;padding:4px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border)}
.chart svg{width:100%;height:auto;display:block}.chart .g{stroke:var(--border);stroke-width:1}.chart .t{fill:var(--muted);font:11px var(--mono)}
.chart .req{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round}.chart .fl{fill:none;stroke:var(--fail);stroke-width:2;stroke-dasharray:6 3;stroke-linejoin:round}
.chart .mk{fill:var(--fail)}.chart .dot{fill:var(--accent)}
.sw{display:inline-block;width:18px;height:0;border-top:3px solid var(--accent);vertical-align:middle;margin-right:6px}.sw.dash{border-top:3px dashed var(--fail)}
.chart details{margin-top:8px}.chart summary{cursor:pointer;font-size:12px}.chart .scroll{overflow-x:auto;max-height:260px}
footer{margin-top:18px;color:var(--muted);font-size:12px}
@media (max-width:640px){.colhead{grid-template-columns:1.6rem 4rem minmax(0,1fr) 6rem}.colhead .hide-sm{display:none}details.row>summary{grid-template-columns:1.6rem 4rem minmax(0,1fr) 6rem}details.row>summary .hide-sm{display:none}}
@media print{body{background:#fff}.no-print{display:none}details.row .detail{display:block}.card,.tile{break-inside:avoid}}
`;

/** Theme toggle and the results filter. No data is read or sent; it only flips attributes. */
const SCRIPT = `
(function(){
  var root=document.documentElement;
  var t=document.getElementById('theme');
  if(t){t.addEventListener('click',function(){
    var cur=root.getAttribute('data-theme');
    var dark=cur?cur==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme',dark?'light':'dark');
    t.textContent=dark?'Dark theme':'Light theme';
  });}
  var buttons=document.querySelectorAll('[data-filter]');
  var rows=document.querySelectorAll('details.row');
  buttons.forEach(function(b){b.addEventListener('click',function(){
    var f=b.getAttribute('data-filter');
    buttons.forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false');});
    rows.forEach(function(r){r.hidden=!(f==='all'||r.getAttribute('data-outcome')===f);});
  });});
})();
`;

function tile(label: string, value: string, tone = ""): string {
  return `<div class="tile ${tone}"><div class="label">${e(label)}</div><div class="value">${e(value)}</div></div>`;
}

function resultRow(row: RunReportRow): string {
  const body: string[] = [];
  if (row.reason) {
    body.push(`<p><strong>${e(row.reason)}.</strong> ${e(REASON_EXPLANATION[row.reason] ?? "")}</p>`);
  }
  if (row.failedTests.length > 0) {
    body.push(
      `<p class="muted">Failed tests</p><ul>${row.failedTests
        .map((test) => `<li><strong>${e(test.name)}</strong>${test.detail ? `<div class="mono">${e(test.detail)}</div>` : ""}</li>`)
        .join("")}</ul>`,
    );
  }
  body.push(`<p class="muted">${row.passedTestCount} test${row.passedTestCount === 1 ? "" : "s"} passed${row.edited ? " · request was edited before the run" : ""}</p>`);
  return `<details class="row" data-outcome="${row.outcome === "Passed" ? "pass" : row.outcome === "Failed" ? "fail" : "skip"}">
<summary><span class="muted num">${row.position}</span>${methodBadge(row.method)}<span class="mono" style="overflow-wrap:anywhere">${e(row.name)}</span>${outcomeBadge(row)}<span class="num hide-sm">${row.statusCode ?? "-"}</span><span class="num hide-sm">${e(duration(row))}</span></summary>
<div class="detail">${body.join("")}</div></details>`;
}

export const CHART_BOX = { x: 56, y: 12, w: 648, h: 170 };
const CHART_TABLE_LIMIT = 120;

const pts = (line: readonly (readonly [number, number])[]) => line.map(([px, py]) => `${px},${py}`).join(" ");

/** The per-second graph as inline SVG from the shared layout (the PDF draws the same one), with a text alternative. */
export function seriesChartHtml(series: RunReportModel["series"]): string {
  const chart = buildSeriesChart(series);
  if (!chart) return `<p class="empty">${e(NO_REQUESTS_NOTE)}</p>`;
  const layout = layoutSeriesChart(chart, CHART_BOX);
  const bottom = CHART_BOX.y + CHART_BOX.h;
  const parts: string[] = [];
  for (const mark of layout.yMarks) {
    parts.push(`<line class="g" x1="${CHART_BOX.x}" y1="${mark.y}" x2="${CHART_BOX.x + CHART_BOX.w}" y2="${mark.y}"></line>`);
    parts.push(`<text class="t" x="${CHART_BOX.x - 8}" y="${mark.y + 4}" text-anchor="end">${e(mark.label)}</text>`);
  }
  for (const mark of layout.xMarks) {
    parts.push(`<line class="g" x1="${mark.x}" y1="${CHART_BOX.y}" x2="${mark.x}" y2="${bottom}"></line>`);
    parts.push(`<text class="t" x="${mark.x}" y="${bottom + 16}" text-anchor="middle">${e(mark.label)}</text>`);
  }
  parts.push(`<text class="t" x="${CHART_BOX.x + CHART_BOX.w / 2}" y="${bottom + 34}" text-anchor="middle">Elapsed time (mm:ss) · requests per second</text>`);
  if (chart.points.length === 1) {
    parts.push(`<circle class="dot" cx="${layout.requestsLine[0][0]}" cy="${layout.requestsLine[0][1]}" r="4"></circle>`);
  } else {
    parts.push(`<polyline class="req" points="${pts(layout.requestsLine)}"></polyline>`);
    parts.push(`<polyline class="fl" points="${pts(layout.failuresLine)}"></polyline>`);
  }
  for (const [mx, my] of layout.failureMarkers) parts.push(`<rect class="mk" x="${mx - 3}" y="${my - 3}" width="6" height="6"></rect>`);
  const table =
    chart.points.length > CHART_TABLE_LIMIT
      ? ""
      : `<details><summary>Figures per ${chart.bucketSeconds === 1 ? "second" : `${chart.bucketSeconds}-second step`}</summary><div class="scroll"><table><thead><tr><th class="num">From (s)</th><th class="num">Requests</th><th class="num">Failed</th><th class="num">Requests/s</th></tr></thead><tbody>${chart.points
          .map((point) => `<tr><td class="num">${point.second}</td><td class="num">${point.requests}</td><td class="num">${point.failures}</td><td class="num">${point.requestsPerSecond}</td></tr>`)
          .join("")}</tbody></table></div></details>`;
  return `<div class="chart"><div class="legend"><span class="sw"></span>Requests per second (solid) · peak ${chart.peak} &nbsp; <span class="sw dash"></span>Failed per second (dashed, square marks) · ${chart.failingSteps} of ${chart.points.length} with failures</div>
<svg viewBox="0 0 720 ${bottom + 42}" role="img" aria-label="${e(chart.summary)}">${parts.join("")}</svg>
<div class="legend">${e(chart.note)}</div>${table}</div>`;
}

/**
 * The run as one self-contained HTML file: inline styles and a few lines of script, no network
 * requests, fonts or images, so it opens anywhere and can be attached to a ticket. Deterministic (all
 * times come from the run). It carries outcomes only, never request or response headers or bodies
 * (see `runReport.ts`), and every value is HTML-escaped because names come from an uploaded file.
 * A content security policy blocks any network access should the file ever be altered.
 */
export function renderRunReportHtml(model: RunReportModel): string {
  const insights = buildRunInsights(model);
  const { summary } = model;
  const maxSlow = Math.max(1, ...insights.slowest.map((row) => row.durationMs));
  const passRate = insights.passRate === null ? "-" : `${insights.passRate}%`;

  const strip = model.rows
    .map((row) => `<span class="cell ${row.outcome === "Passed" ? "p" : row.outcome === "Failed" ? "f" : ""}" title="${e(`${row.position}. ${row.method} ${row.name}: ${row.outcome}`)}"></span>`)
    .join("");

  const attention =
    insights.failures.length === 0
      ? `<p class="empty">${summary.total === 0 ? "No requests were recorded." : "No request failed."}</p>`
      : `<table><thead><tr><th>#</th><th>Request</th><th>Why</th><th class="num">HTTP</th></tr></thead><tbody>${insights.failures
          .map(
            (row) =>
              `<tr><td class="num muted">${row.position}</td><td>${methodBadge(row.method)} <span class="mono" style="overflow-wrap:anywhere">${e(row.name)}</span></td><td>${e(row.reason ?? "Failed")}${row.failedTests[0]?.detail ? `<div class="mono muted">${e(row.failedTests[0].detail)}</div>` : ""}</td><td class="num">${row.statusCode ?? "-"}</td></tr>`,
          )
          .join("")}</tbody></table>`;

  const clusters =
    insights.clusters.length === 0
      ? `<p class="empty">Nothing to group.</p>`
      : insights.clusters
          .map(
            (cluster) =>
              `<div class="cluster"><strong>${e(cluster.reason)}</strong> · ${cluster.count} request${cluster.count === 1 ? "" : "s"}${cluster.message ? `<div class="mono">${e(cluster.message)}</div>` : ""}<div class="why">${e(REASON_EXPLANATION[cluster.reason] ?? "")}</div><div class="why">${cluster.requests.map((request) => `${request.position}. ${e(request.name)}`).join(" &middot; ")}</div></div>`,
          )
          .join("");

  const slowest =
    insights.slowest.length === 0
      ? `<p class="empty">No request was sent.</p>`
      : `<table><tbody>${insights.slowest
          .map(
            (row) =>
              `<tr><td>${methodBadge(row.method)} <span class="mono" style="overflow-wrap:anywhere">${e(row.name)}</span><div class="bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round((row.durationMs / maxSlow) * 100))}%"></span></div></td><td class="num">${row.durationMs} ms</td></tr>`,
          )
          .join("")}</tbody></table>`;

  const methods = `<table><thead><tr><th>Method</th><th class="num">Total</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Not attempted</th></tr></thead><tbody>${insights.methods
    .map((m) => `<tr><td>${methodBadge(m.method)}</td><td class="num">${m.total}</td><td class="num">${m.passed}</td><td class="num">${m.failed}</td><td class="num">${m.notAttempted}</td></tr>`)
    .join("")}</tbody></table>`;

  const results =
    model.rows.length === 0
      ? `<p class="empty">No requests were recorded for this run.</p>`
      : `<div class="filters no-print" role="group" aria-label="Filter results">
<button type="button" data-filter="all" aria-pressed="true">All (${summary.total})</button>
<button type="button" data-filter="fail" aria-pressed="false">Failed (${summary.failed})</button>
<button type="button" data-filter="pass" aria-pressed="false">Passed (${summary.passed})</button>
<button type="button" data-filter="skip" aria-pressed="false">Not attempted (${summary.notAttempted})</button></div>
<div class="colhead" aria-hidden="true"><span>#</span><span>Method</span><span>Request</span><span>Outcome</span><span class="hide-sm">HTTP</span><span class="hide-sm">Time</span></div>${model.rows.map(resultRow).join("")}`;

  const facts: [string, string][] = [
    ["Collection", model.collectionName],
    ["Tier", model.tier],
    ["Status", model.statusLabel],
    ["Started", formatReportTime(model.startedAt)],
    ["Completed", model.completedAt ? formatReportTime(model.completedAt) : "Not completed"],
    ["Duration", `${summary.durationMs} ms`],
    ["Run ID", model.runId],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${e(`ApiPilot run report - ${model.collectionName}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header class="top">
<div>
<div class="eyebrow">ApiPilot run report</div>
<h1>${e(model.collectionName)}</h1>
<div class="chips"><span class="chip">${e(model.tier)}</span><span class="chip status-${e(model.status)}">${e(model.statusLabel)}</span><span class="muted">${e(formatReportTime(model.startedAt))}</span></div>
</div>
<button type="button" id="theme" class="no-print">Switch theme</button>
</header>

<div class="tiles">
${tile("Pass rate", passRate, insights.passRate === 100 ? "pass" : "")}
${tile("Requests", String(summary.total))}
${tile("Passed", String(summary.passed), "pass")}
${tile("Failed", String(summary.failed), summary.failed > 0 ? "fail" : "")}
${tile("Not attempted", String(summary.notAttempted))}
${tile("Duration", `${summary.durationMs} ms`)}
</div>

<section class="card" aria-labelledby="strip-h">
<h2 id="strip-h">Run</h2>
<div class="strip" role="img" aria-label="${e(`${summary.passed} passed, ${summary.failed} failed, ${summary.notAttempted} not attempted, in run order`)}">${strip}</div>
<div class="legend">One cell per request, in run order: green passed, red failed, grey not attempted. Hover a cell for its name. Tests: ${insights.tests.passed} passed, ${insights.tests.failed} failed.</div>
</section>

<section class="card" aria-labelledby="series-h"><h2 id="series-h">Requests per second</h2>${seriesChartHtml(model.series)}</section>

<section class="card" aria-labelledby="attention-h"><h2 id="attention-h">Needs attention</h2>${attention}</section>

<div class="grid2">
<section class="card" aria-labelledby="clusters-h"><h2 id="clusters-h">Failure clusters</h2>${clusters}</section>
<section class="card" aria-labelledby="slow-h"><h2 id="slow-h">Slowest requests</h2>${slowest}</section>
</div>

<div class="grid2">
<section class="card" aria-labelledby="methods-h"><h2 id="methods-h">By method</h2>${methods}</section>
<section class="card" aria-labelledby="env-h"><h2 id="env-h">Run details</h2><table><tbody>${facts.map(([label, value]) => `<tr><td class="muted">${e(label)}</td><td class="${label === "Run ID" ? "mono" : ""}">${e(value)}</td></tr>`).join("")}</tbody></table></section>
</div>

<section class="card" aria-labelledby="results-h"><h2 id="results-h">All requests</h2>${results}</section>

<footer>This report lists outcomes only. Request and response headers and bodies, and the collection's variables, are not included. Generated by ApiPilot.</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
