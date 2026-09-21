import type { AnalysisSummary as AnalysisSummaryType } from "@apipilot/shared-domain";

export function AnalysisSummary({ summary }: Readonly<{ summary: AnalysisSummaryType }>) {
  return (
    <section data-testid="analysis-summary" className="space-y-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
        <div className="flex items-baseline gap-1">
          <dt className="text-muted">Operations</dt>
          <dd className="font-semibold text-slate-900 dark:text-white">{summary.operationCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="text-muted">Schemas</dt>
          <dd className="font-semibold text-slate-900 dark:text-white">{summary.schemaCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="text-muted">Security schemes</dt>
          <dd className="font-semibold text-slate-900 dark:text-white">{summary.securitySchemeCount}</dd>
        </div>
      </dl>
      {summary.issues.length > 0 && (
        // Collapsed by default (mirrors WorkflowStageTracker's identical fix): a specification
        // with hundreds of issues previously rendered its entire list inline here, tall enough
        // to push the operation list below the fold on every visit to this stage.
        <details
          role="alert"
          data-testid="analysis-issues"
          className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100"
        >
          <summary className="cursor-pointer font-medium marker:text-warning-500">
            {summary.issues.length} issue{summary.issues.length === 1 ? "" : "s"} found —
            click to expand
          </summary>
          <ul className="mt-2 ml-4 max-h-64 list-disc space-y-1 overflow-y-auto pr-2">
            {summary.issues.map((issue) => (
              <li key={`${issue.kind}-${issue.location}-${issue.message}`}>
                <strong>{issue.kind}</strong> at{" "}
                <code className="font-mono text-xs leading-relaxed">
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
