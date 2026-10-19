import type { SecurityFinding, SecurityReport } from "@apipilot/shared-domain";
import { SCENARIO_OUTCOME_KINDS } from "@apipilot/shared-domain";
import { escapeHtml } from "../../externalCollections/runReportHtml";

const e = escapeHtml;

/**
 * A self-contained HTML security assessment (specs/057 FR-061, FR-062), in the presentation of the coverage report:
 * one file, no script, no external resource, light and dark aware. It is a pure function of the report it is given,
 * and **every** interpolated value goes through `escapeHtml`, because identifiers, titles, summaries and labels
 * come from an uploaded specification and from a target's responses. It carries counts, outcomes, redacted observed
 * summaries and static text, never a credential, a request, a response or evidence.
 */

const STYLE = `
:root{--bg:#f6f8fa;--surface:#fff;--border:#d8dee6;--text:#14202e;--muted:#5b6878;--accent:#047857;--warn:#92400e;--bad:#b91c1c;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#9aa7b8;--accent:#34d399;--warn:#fbbf24;--bad:#f87171;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px;display:grid;gap:16px}
section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 18px;overflow-x:auto}
h1{margin:0;font-size:20px}h2{margin:0 0 8px;font-size:15px}h3{margin:0 0 6px;font-size:13px}p{margin:4px 0}.muted{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--border)}
td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}.mono{font-family:ui-monospace,Consolas,monospace}
.note{border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin:6px 0}.note.warning{border-color:var(--warn);color:var(--warn)}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.group{border:1px solid var(--border);border-radius:8px;padding:10px 12px}
dl{margin:0}dt{font-size:12px;color:var(--muted)}dd{margin:0 0 8px;word-break:break-word}dd:last-child{margin-bottom:0}
.finding{border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin:8px 0}.tag{display:inline-block;border:1px solid var(--muted);border-radius:999px;padding:0 8px;font-size:11px;font-weight:700;margin-right:6px}
`;

const list = (items: readonly string[]): string => (items.length === 0 ? "<p class=\"muted\">None.</p>" : `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`);

function counts(record: Readonly<Record<string, number>>): string {
  const entries = Object.entries(record);
  return entries.length === 0 ? "none" : entries.map(([name, count]) => `${e(name.replaceAll("_", " "))}: ${count}`).join(", ");
}

function findingBlock(finding: SecurityFinding): string {
  const latest = finding.occurrences.at(-1);
  const taxonomy = finding.taxonomy.map((entry) => `${entry.id} (${entry.relation})`).join(", ");
  return `<div class="finding">
<h3><span class="tag">${e(finding.severity.current)}</span><span class="tag">${e(finding.status)}</span>${e(finding.operationKey)} · ${e(finding.categoryId)}</h3>
<dl>
<dt>Finding</dt><dd class="mono">${e(finding.id)} (scenario ${e(finding.scenarioId)}, version ${finding.scenarioVersion})</dd>
<dt>Expected</dt><dd>${e(finding.expected.statement)} <span class="muted">(${e(finding.expected.basis === "documented" ? "documented in the specification" : `product rule ${finding.expected.ruleId ?? ""}`)})</span></dd>
<dt>Observed (latest of ${finding.occurrenceCount} occurrence${finding.occurrenceCount === 1 ? "" : "s"})</dt><dd>${latest ? e(latest.observed.statement) : "none recorded"}</dd>
<dt>Confidence</dt><dd>${e(finding.confidence.level)}: ${e(finding.confidence.basis)}</dd>
<dt>Severity</dt><dd>${e(finding.severity.current)}${finding.severity.current === finding.severity.suggested ? "" : ` (suggested ${e(finding.severity.suggested)})`}</dd>
<dt>Status</dt><dd>${e(finding.status)}${finding.status === "resolved" ? ` (${e(finding.resolvedAssertion.replaceAll("-", " "))})` : ""}${finding.unreviewedOccurrence ? " · has an occurrence not yet reviewed" : ""}</dd>
<dt>Remediation</dt><dd>${e(finding.remediation)}</dd>
<dt>Specification element</dt><dd class="mono">${e(finding.specElementPointer)}</dd>
<dt>Taxonomy</dt><dd>${e(taxonomy)}</dd>
${finding.supersedes ? `<dt>Supersedes</dt><dd class="mono">${e(finding.supersedes)}</dd>` : ""}
</dl>
</div>`;
}

export function renderSecurityReportHtml(report: SecurityReport): string {
  const { overview } = report;
  const coverageRows = report.categoryCoverage
    .map(
      (category) =>
        `<tr><td>${e(category.name)}</td><td>${e(category.supportLevel)}</td><td class="mono">${category.scenarios}</td><td>${SCENARIO_OUTCOME_KINDS.map((kind) => `${e(kind.replaceAll("_", " "))} ${category.outcomes[kind]}`).join(", ")}</td></tr>`,
    )
    .join("");
  const runRows = report.runs
    .map((run) => `<tr><td class="mono">${e(run.id)}</td><td>${e(run.startedAt)}</td><td>${e(run.status)}</td><td>${e(run.profileName)}</td><td>${e(run.tier)}</td><td class="mono">${e(run.baseUrl)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security assessment</title><style>${STYLE}</style></head><body><main>
<section>
<h1>Security assessment</h1>
<p class="muted">${report.assessmentLabel ? `${e(report.assessmentLabel)} · ` : ""}generated ${e(report.generatedAt)} · taxonomy ${e(report.taxonomyEdition)}${report.specificationRevision ? ` · specification revision <span class="mono">${e(report.specificationRevision.slice(0, 12))}</span>` : " · no specification was loaded"}</p>
<p class="note warning">${e(report.limitsStatement)}</p>
</section>
<section>
<h2>Summary</h2>
<div class="grid">
<div class="group"><h3>Potential risks (from the specification, not proof)</h3><p>${counts(overview.observationCounts)}</p></div>
<div class="group"><h3>Findings (from requests sent)</h3><p>${overview.findingCounts.total} finding${overview.findingCounts.total === 1 ? "" : "s"}: severity ${counts(overview.findingCounts.bySeverity)}; status ${counts(overview.findingCounts.byStatus)}</p><p class="muted">${overview.findingCounts.occurrences} occurrence${overview.findingCounts.occurrences === 1 ? "" : "s"} in total (counted apart from findings)</p></div>
<div class="group"><h3>Scenarios</h3><p>${overview.scenarioCounts.total} in all; review status ${counts(overview.scenarioCounts.byReviewState)}</p></div>
</div>
</section>
<section>
<h2>Category coverage and outcomes</h2>
<table><thead><tr><th>Category</th><th>Support</th><th>Scenarios</th><th>Outcomes in the included runs</th></tr></thead><tbody>${coverageRows}</tbody></table>
</section>
<section>
<h2>Findings and remediation</h2>
${report.findings.length === 0 ? "<p>No finding was recorded for the included runs.</p>" : report.findings.map(findingBlock).join("")}
</section>
<section>
<h2>Runs included</h2>
${report.runs.length === 0 ? "<p>No run is included in this report.</p>" : `<table><thead><tr><th>Run</th><th>Started</th><th>Status</th><th>Profile</th><th>Tier</th><th>Target</th></tr></thead><tbody>${runRows}</tbody></table>`}
</section>
<section>
<h2>What was not covered, and why</h2>
${list(report.notCovered.map((entry) => `<span class="mono">${e(entry.categoryId)}</span>: ${e(entry.reason)}`))}
</section>
</main></body></html>`;
}

/** `apipilot-security-assessment-<date>.<ext>`, with nothing from the specification in the name. */
export function securityReportFileName(report: SecurityReport, format: "html" | "json"): string {
  return `apipilot-security-assessment-${report.generatedAt.slice(0, 10)}.${format}`;
}
