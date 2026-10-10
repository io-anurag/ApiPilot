import type { CoverageEvidenceRef, CoverageSnapshot } from "@apipilot/shared-domain";
import { escapeHtml } from "../externalCollections/runReportHtml";

const e = escapeHtml;

const STYLE = `
:root{--bg:#f6f8fa;--surface:#fff;--border:#d8dee6;--text:#14202e;--muted:#5b6878;--accent:#047857;--warn:#92400e;--bad:#b91c1c;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#9aa7b8;--accent:#34d399;--warn:#fbbf24;--bad:#f87171;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px;display:grid;gap:16px}
section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 18px;overflow-x:auto}
h1{margin:0;font-size:20px}h2{margin:0 0 8px;font-size:15px}p{margin:4px 0}.muted{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--border)}
td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}.mono{font-family:ui-monospace,Consolas,monospace}
.note{border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin:6px 0}.note.warning{border-color:var(--warn);color:var(--warn)}
.tag{display:inline-block;border:1px solid var(--muted);border-radius:999px;padding:0 8px;font-size:11px;font-weight:700}
`;

const pct = (value: number | null): string => (value === null ? "not available" : `${value}%`);

function evidenceCell(refs: CoverageEvidenceRef[]): string {
  if (refs.length === 0) return "none";
  return refs
    .map((r) => `${e(r.verdict)}${r.cause ? ` (${e(r.cause.replaceAll("-", " "))})` : ""}: run ${e(r.runId)}, scenario ${e(r.scenarioId)}${r.itemId ? `, item ${e(r.itemId)}` : ""}${r.note ? ` (${e(r.note)})` : ""}`)
    .join("<br>");
}

/**
 * A self-contained HTML export of a coverage view. Every interpolated value is escaped. Carries
 * identifiers, counts and outcomes only: no headers, bodies, URLs or credentials (FR-036). The
 * `scopeLabel` states which view this is, so a reader never mistakes a filtered view for the whole.
 */
export function renderCoverageHtml(snapshot: CoverageSnapshot, scopeLabel: string): string {
  const spec = snapshot.specification;
  const exec = snapshot.execution;
  const metricRows = snapshot.metrics
    .map(
      (m) =>
        `<tr><td>${e(m.label)}</td><td>${e(m.dimension)}</td><td class="mono">${m.numerator} / ${m.denominator}</td><td>${e(pct(m.percentage))}</td><td class="muted">${e(m.basis)}</td></tr>`,
    )
    .join("");
  const operationRows = snapshot.operations
    .map((o) => {
      const v = o.scenarioVerdicts;
      const c = o.stateCounts;
      return `<tr><td>${e(o.method)}</td><td class="mono">${e(o.path)}</td><td class="mono">${o.specification.covered} / ${o.specification.total}</td><td class="mono">${o.runtime.verified} / ${o.runtime.total}</td><td class="muted">verified ${c.verified}, failed ${c["executed-failed"]}, inconclusive ${c.inconclusive}, stale ${c.stale}, not executed ${c["generated-not-executed"]}, not covered ${c["not-covered"]}</td><td class="muted">${v.passed} passed, ${v.failed} failed, ${v.inconclusive} inconclusive, ${v.notExecuted} not executed</td><td>${e(o.priority)}</td><td>${o.missing.map(e).join("<br>") || "none"}</td></tr>`;
    })
    .join("");
  const oc = snapshot.operationCounts;
  const categoryRows = snapshot.categoryCoverage
    .map((c) =>
      c.available
        ? `<tr><td>${e(c.group)}</td><td class="mono">${c.specCovered} / ${c.eligible} (${e(pct(c.eligible === 0 ? null : Math.round((c.specCovered / c.eligible) * 1000) / 10))})</td><td class="mono">${c.verified} / ${c.eligible} (${e(pct(c.eligible === 0 ? null : Math.round((c.verified / c.eligible) * 1000) / 10))})</td><td class="muted">failed ${c.counts["executed-failed"]}, inconclusive ${c.counts.inconclusive}, stale ${c.counts.stale}, not executed ${c.counts["generated-not-executed"]}, not covered ${c.counts["not-covered"]}</td></tr>`
        : `<tr><td>${e(c.group)}</td><td colspan="3">Unavailable: ${e(c.reason ?? "not measurable")}</td></tr>`,
    )
    .join("");
  const unclassifiedList = snapshot.unclassified.requirements.map((u) => `${e(u.operationKey)} ${e(u.label)}`).join("; ");
  const evidenceLine = exec.evidenceMode === "single-run"
    ? `single run ${e(exec.selectedRunId ?? "")}`
    : `latest qualifying result per scenario from ${exec.evidenceByRun.map((r) => `run ${e(r.runId)} (${r.scenarios})`).join(", ") || "no run"}`;
  const excludedLine = exec.excludedRuns.length
    ? `Excluded: ${exec.excludedRuns.map((r) => `run ${e(r.runId)} (${e(r.reason)}: ${e(r.environment.name)}, ${e(r.environment.tier)})`).join(", ")}.`
    : "";
  const gapRows = snapshot.gaps
    .map(
      (g) =>
        `<tr><td class="mono">${e(g.operationKey)}</td><td>${e(g.state.replaceAll("-", " "))}${g.cause ? `<div class="muted">${e(g.cause.replaceAll("-", " "))}</div>` : ""}</td><td>${e(g.priority)}</td><td>${e(g.reason)}</td><td class="muted">${g.factors.map((f) => `${e(f.factor)} +${f.points}`).join(", ")} = ${g.score} (heuristic)</td><td class="muted">${evidenceCell(g.evidence)}</td></tr>`,
    )
    .join("");
  const recRows = snapshot.recommendations
    .map(
      (r) =>
        `<tr><td>${r.rank}</td><td class="mono">${e(r.operationKey)}</td><td>${e(r.requirement)}</td><td>${e(r.why)}</td><td>${e(r.priority)}</td><td>${e(r.action.type.replaceAll("-", " "))}</td></tr>`,
    )
    .join("");
  const notMeasurableRows = snapshot.notMeasurable
    .map((n) => `<tr><td>${e(n.operationKey ?? "document")}</td><td>${e(n.label)}</td><td>${e(n.reason)}</td></tr>`)
    .join("");
  const notices = snapshot.notices
    .map((n) => `<div class="note ${e(n.severity)}">${e(n.message)}</div>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>API Test Coverage - ${e(spec.name)}</title><style>${STYLE}</style></head>
<body><main>
<section><h1>API Test Coverage</h1>
<p>${e(spec.name)}${spec.version ? ` v${e(spec.version)}` : ""} <span class="muted mono">revision ${e(spec.revision.slice(0, 12))}</span></p>
<p class="muted">${e(scopeLabel)}. Calculated ${e(snapshot.calculatedAt)}.</p>
<p class="muted">Scenarios: ${snapshot.context.scenarioCounts.accepted} accepted, ${snapshot.context.scenarioCounts.pending} pending, ${snapshot.context.scenarioCounts.rejected} rejected (rejected scenarios never count).
Evidence: ${evidenceLine}${exec.lastQualifyingExecutionAt ? `, last qualifying execution ${e(exec.lastQualifyingExecutionAt)}` : ", no qualifying execution"}.
${exec.environments.length ? `Environment: ${exec.environments.map((x) => `${e(x.name)} (${e(x.tier)})`).join(", ")}.` : ""} ${excludedLine}
Unattributed results: ${exec.unattributedResults} (possibly from an earlier specification; never counted as verified).</p>
${notices}</section>
<section><h2>Metrics and definitions</h2><table><thead><tr><th>Metric</th><th>Dimension</th><th>Count</th><th>Percentage</th><th>Numerator and denominator</th></tr></thead><tbody>${metricRows}</tbody></table>
<p class="muted">Specification coverage means a qualifying generated scenario exists. Runtime-verified coverage requires qualifying execution evidence. No overall score is computed.</p></section>
<section><h2>Operation-level counts</h2><p class="mono">Eligible ${oc.eligible}; with generated scenarios ${oc.withScenarios}; with passing verification ${oc.withPassingVerification}; with execution failures ${oc.withFailures}; with no scenarios ${oc.withNoScenarios}.</p>
<p class="muted">An operation can be in both passing verification and failures. Neither measures completeness; read requirement-level coverage.</p></section>
<section><h2>Coverage by scenario category</h2><table><thead><tr><th>Category</th><th>Specification</th><th>Runtime-verified</th><th>Other states</th></tr></thead><tbody>${categoryRows}</tbody></table>
<p class="muted">Counted in classified testable requirements, never scenarios. ${snapshot.unclassified.requirements.length ? `Unclassified (in no category denominator): ${unclassifiedList}.` : "No unclassified requirements."}</p></section>
<section><h2>Operations</h2><table><thead><tr><th>Method</th><th>Endpoint</th><th>Specification</th><th>Runtime verified</th><th>Requirement states</th><th>Scenarios</th><th>Priority</th><th>Missing</th></tr></thead><tbody>${operationRows}</tbody></table></section>
<section><h2>Coverage gaps</h2><table><thead><tr><th>Operation</th><th>State</th><th>Priority</th><th>Gap</th><th>Rationale</th><th>Evidence</th></tr></thead><tbody>${gapRows}</tbody></table></section>
<section><h2>Recommended next tests</h2><table><thead><tr><th>#</th><th>Operation</th><th>Requirement</th><th>Why</th><th>Priority</th><th>Action</th></tr></thead><tbody>${recRows}</tbody></table></section>
<section><h2>Not measurable</h2><table><thead><tr><th>Operation</th><th>Element</th><th>Reason</th></tr></thead><tbody>${notMeasurableRows || '<tr><td colspan="3">None</td></tr>'}</tbody></table>
${snapshot.outOfScopeOperations.length ? `<p class="muted">Out of scope (not selected for generation): ${snapshot.outOfScopeOperations.map(e).join(", ")}</p>` : ""}</section>
</main></body></html>`;
}

/** A file-name-safe slug of the specification name, for the download name. */
export function coverageFileName(snapshot: CoverageSnapshot, extension: "html" | "json"): string {
  const slug = snapshot.specification.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "specification";
  return `apipilot-coverage-${slug}-${snapshot.calculatedAt.slice(0, 10)}.${extension}`;
}
