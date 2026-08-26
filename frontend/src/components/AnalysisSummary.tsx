import type { AnalysisSummary as AnalysisSummaryType } from "@apipilot/shared-domain";

export function AnalysisSummary({ summary }: { summary: AnalysisSummaryType }) {
  return (
    <section data-testid="analysis-summary">
      <ul>
        <li>Operations: {summary.operationCount}</li>
        <li>Schemas: {summary.schemaCount}</li>
        <li>Security schemes: {summary.securitySchemeCount}</li>
      </ul>
      {summary.issues.length > 0 && (
        <div role="alert" data-testid="analysis-issues">
          <p>{summary.issues.length} issue(s) found:</p>
          <ul>
            {summary.issues.map((issue, i) => (
              <li key={i}>
                <strong>{issue.kind}</strong> at {issue.location}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
