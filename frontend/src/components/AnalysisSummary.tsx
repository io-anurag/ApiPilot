import type { AnalysisSummary as AnalysisSummaryType } from "@apipilot/shared-domain";
import { KeyValueGrid } from "./patterns/KeyValueGrid";

export function AnalysisSummary({ summary }: Readonly<{ summary: AnalysisSummaryType }>) {
  return (
    <section data-testid="analysis-summary" className="space-y-3">
      <KeyValueGrid
        items={[
          { label: "Operations", value: summary.operationCount },
          { label: "Schemas", value: summary.schemaCount },
          { label: "Security schemes", value: summary.securitySchemeCount },
        ]}
      />
      {summary.issues.length > 0 && (
        // Collapsed by default (mirrors WorkflowStageTracker's identical fix): a specification
        // with hundreds of issues previously rendered its entire list inline here, tall enough
        // to push the operation list below the fold on every visit to this stage. Styled as the
        // warning banner of the pattern set; a <details> cannot be a Banner, which has a fixed
        // title and body, so the banner's classes are repeated here.
        <details
          role="alert"
          data-testid="analysis-issues"
          className="rounded-xl border border-warning-600/30 bg-warning-100 px-3.5 py-3 text-sm text-text-primary dark:bg-warning-500/10"
        >
          <summary className="cursor-pointer font-semibold text-warning-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-warning-100">
            {summary.issues.length} issue{summary.issues.length === 1 ? "" : "s"} found —
            click to expand
          </summary>
          <ul className="mt-2 ml-4 max-h-64 list-disc space-y-1 overflow-y-auto pr-2 text-text-secondary">
            {summary.issues.map((issue) => (
              <li key={`${issue.kind}-${issue.location}-${issue.message}`} className="break-words">
                <strong>{issue.kind}</strong> at{" "}
                <code className="break-all font-mono text-xs leading-relaxed">
                  {issue.location}
                </code>
                : {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
