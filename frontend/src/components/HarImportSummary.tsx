import type { ExclusionReason, ImportAnalysisReport } from "@apipilot/shared-domain";
import { KeyValueGrid } from "./patterns/KeyValueGrid";

/**
 * What a HAR upload imported, excluded and found malformed, shown before anything is generated
 * (specs/056 FR-042, US3). Counts are the report's own and reconcile exactly; every exclusion names
 * its rule. It never shows a credential: the report carries none.
 */

const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  "analytics-telemetry": "Analytics or telemetry request",
  "static-asset": "Static asset (image, font, stylesheet or script)",
  "html-document": "HTML page",
  "cors-preflight": "CORS preflight request",
  streaming: "WebSocket or streaming exchange",
  "failed-request": "Failed request (no response)",
  redirect: "Redirect response",
  "not-modified": "Not-modified (304) response",
  "non-http-scheme": "Not an HTTP or HTTPS request",
  "third-party-origin": "Unrelated third-party origin",
  "duplicate-method-path-other-origin": "Same method and path already imported from another origin",
};

const MALFORMED_LABELS: Record<string, string> = {
  "missing-url": "no request URL",
  "missing-method": "no request method",
  "missing-response-status": "no response status",
  "invalid-url": "the URL could not be parsed",
  "relative-url": "the URL is relative, so there is no host",
  "not-an-object": "the entry is not an object",
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function HarImportSummary({ report }: Readonly<{ report: ImportAnalysisReport }>) {
  const { counts } = report;
  return (
    <section data-testid="har-import-summary" aria-labelledby="har-import-summary-title" className="space-y-3">
      <h3 id="har-import-summary-title" className="text-sm font-semibold text-text-primary">
        Capture import summary
      </h3>
      <KeyValueGrid
        testId="har-import-counts"
        items={[
          { label: "Entries in file", value: counts.total },
          { label: "Imported entries", value: counts.imported },
          { label: "Excluded entries", value: counts.excluded },
          { label: "Malformed entries", value: counts.malformed },
          { label: "Operations identified", value: counts.operations },
        ]}
      />
      <p data-testid="har-import-reconciliation" className="text-xs text-text-secondary">
        {counts.imported} imported + {counts.excluded} excluded + {counts.malformed} malformed = {counts.total} entries in
        the file.
        {report.creator ? ` Captured with ${report.creator}.` : ""}
      </p>
      <p className="text-xs text-text-secondary">
        Everything below was observed in the capture. It is not a documented contract: a status that was seen once is not
        a guarantee, and nothing that was not seen is included.
      </p>

      {report.origins.length > 0 && (
        <p data-testid="har-import-origins" className="text-xs text-text-secondary">
          Origins:{" "}
          {report.origins.map((origin, index) => (
            <span key={origin.origin}>
              {index > 0 ? "; " : ""}
              <span className="font-mono">{origin.origin}</span> ({origin.operations}{" "}
              {plural(origin.operations, "operation", "operations")}, {origin.importedEntries}{" "}
              {plural(origin.importedEntries, "entry", "entries")})
            </span>
          ))}
        </p>
      )}

      {report.exclusions.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table data-testid="har-import-exclusions" className="w-full min-w-[32rem] text-left text-sm">
            <caption className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Excluded entries by reason
            </caption>
            <thead className="bg-surface-subtle text-xs text-text-secondary">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Reason</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Entries</th>
                <th scope="col" className="px-3 py-2 font-medium">Examples</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.exclusions.map((group) => (
                <tr key={group.reason}>
                  <th scope="row" className="px-3 py-2 font-medium text-text-primary">
                    {EXCLUSION_LABELS[group.reason] ?? group.reason}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{group.count}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {group.samples.slice(0, 3).map((sample) => (
                      <span key={sample.entryIndex} className="mr-3 inline-block break-all font-mono">
                        {sample.method} {sample.host}
                        {sample.path}
                      </span>
                    ))}
                    {group.count > 3 && <span> and {group.count - 3} more</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.malformedEntries.length > 0 && (
        <details data-testid="har-import-malformed" className="rounded-xl border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            {report.malformedEntries.length} malformed {plural(report.malformedEntries.length, "entry", "entries")} skipped
          </summary>
          <ul className="mt-2 ml-4 max-h-48 list-disc space-y-1 overflow-y-auto pr-2 text-xs text-text-secondary">
            {report.malformedEntries.map((entry) => (
              <li key={entry.entryIndex}>
                Entry {entry.entryIndex + 1}: {MALFORMED_LABELS[entry.reason] ?? entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.credentialUrlCount > 0 && (
        <p data-testid="har-import-credential-urls" className="text-xs text-text-secondary">
          {report.credentialUrlCount} {plural(report.credentialUrlCount, "entry", "entries")} had credentials in the URL
          (entries {report.credentialUrlEntries.map((entry) => entry.entryIndex + 1).join(", ")}
          {report.credentialUrlCount > report.credentialUrlEntries.length ? ", and more" : ""}). They were removed and
          never kept.
        </p>
      )}

      {report.limitsApplied.length > 0 && (
        <ul data-testid="har-import-limits" className="space-y-1 text-xs text-text-secondary">
          {report.limitsApplied.map((applied) => (
            <li key={applied.limit}>
              Limit {applied.limit}: {applied.count} {plural(applied.count, "body", "bodies")} {applied.effect}.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
