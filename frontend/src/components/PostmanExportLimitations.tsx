import { aggregateLimitations, type GenerationLimitation } from "@apipilot/shared-domain";

/** Human-readable headings for each recorded gap, matching the accompanying document. */
const LIMITATION_HEADINGS: Record<GenerationLimitation["kind"], string> = {
  "no-expected-outcome": "Scenarios with no expected outcome",
  "undocumented-status-code": "Responses the specification did not document concretely",
  "unsupported-auth-scheme": "Authentication schemes this export cannot configure",
  "unsupported-content-type": "Request content types this export cannot represent",
  "unresolved-path-parameter": "Path parameters with no approved value",
  "specification-analysis-issue": "Operations carrying specification analysis issues",
  "alternative-auth-requirement-selected":
    "Operations declaring alternative authentication",
  "workflow-missing-scenario": "Workflow steps without an approved scenario",
  "workflow-unsupported-sequence": "Workflow sequences this export cannot render",
  "workflow-unresolved-handoff": "Workflow handoffs this export cannot resolve",
  "workflow-unsupported-extraction-path":
    "Workflow response paths this export cannot extract",
  "workflow-unsupported-request-representation":
    "Workflow request representations this export cannot render",
  "unresolved-credential-producer":
    "Distinct credentials this export could not identify a producer request for",
  "unresolved-parameter-style": "Parameter serialization styles this export cannot represent",
};

/** Labels which approved scenario(s) a grouped limitation entry came from. */
function scenarioLabel(scenarioIds: string[]): string {
  if (scenarioIds.length === 0) return "";
  if (scenarioIds.length === 1) return ` (${scenarioIds[0]})`;
  return ` (${scenarioIds.length} scenarios)`;
}

/**
 * Lists what the export could not express (FR-017). A limitation is reported, never silently
 * omitted or filled in, and it does not make the export a failure.
 */
export function PostmanExportLimitations({
  limitations,
}: {
  limitations: GenerationLimitation[];
}) {
  if (limitations.length === 0) {
    return (
      <p data-testid="export-limitations-none" className="text-sm text-success-700 dark:text-success-400">
        No limitations recorded: every approved scenario was expressed in full.
      </p>
    );
  }

  const kinds = [...new Set(limitations.map((limitation) => limitation.kind))];

  return (
    <section
      aria-labelledby="export-limitations-heading"
      data-testid="export-limitations"
      className="space-y-2 rounded-md border border-warning-200 bg-warning-50 p-3 dark:border-warning-500 dark:bg-warning-500/10"
    >
      <h4
        id="export-limitations-heading"
        className="text-sm font-semibold text-warning-700 dark:text-warning-100"
      >
        Known limitations ({limitations.length})
      </h4>
      <p className="text-sm text-warning-700 dark:text-warning-100">
        These cases could not be expressed in the collection. They are reported rather
        than filled in with an assumed value.
      </p>
      {kinds.map((kind) => {
        const forKind = limitations.filter((limitation) => limitation.kind === kind);
        const aggregated = aggregateLimitations(forKind);
        return (
          // Collapsed by default (mirrors WorkflowStageTracker's/AnalysisSummary's identical
          // fix): a specification with hundreds of limitations of one kind previously rendered
          // its entire list inline here, unbounded.
          <details key={kind} data-testid={`export-limitation-${kind}`}>
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-warning-700 marker:text-warning-500 dark:text-warning-100">
              {LIMITATION_HEADINGS[kind]} ({forKind.length})
            </summary>
            <ul className="mt-1 ml-4 max-h-64 list-disc space-y-1 overflow-y-auto pr-2 text-sm text-slate-700 dark:text-slate-300">
              {aggregated.map((limitation, index) => (
                <li key={`${limitation.location}-${limitation.scenarioIds[0] ?? index}`}>
                  <code className="font-mono text-xs">{limitation.location}</code>
                  {scenarioLabel(limitation.scenarioIds)}: {limitation.message}
                  {limitation.occurrences > 1
                    ? ` — affects ${limitation.occurrences} requests`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
