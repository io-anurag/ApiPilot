import type { AnalysisSummary as AnalysisSummaryType } from "@apipilot/shared-domain";

export function AnalysisSummary({ summary }: { summary: AnalysisSummaryType }) {
  return (
    <section data-testid="analysis-summary" className="space-y-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
        <div className="flex items-baseline gap-1">
          <dt className="text-muted">Operations</dt>
          <dd className="font-semibold text-slate-900">{summary.operationCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="text-muted">Schemas</dt>
          <dd className="font-semibold text-slate-900">{summary.schemaCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="text-muted">Security schemes</dt>
          <dd className="font-semibold text-slate-900">{summary.securitySchemeCount}</dd>
        </div>
      </dl>
      {summary.issues.length > 0 && (
        <div role="alert" data-testid="analysis-issues" className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <p className="font-medium">{summary.issues.length} issue(s) found:</p>
          <ul className="ml-4 list-disc">
            {summary.issues.map((issue, i) => (
              <li key={i}>
                <strong>{issue.kind}</strong> at <code className="font-mono text-xs">{issue.location}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
