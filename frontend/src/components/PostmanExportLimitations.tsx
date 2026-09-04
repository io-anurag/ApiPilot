import type { GenerationLimitation } from "@apipilot/shared-domain";

/** Human-readable headings for each recorded gap, matching the accompanying document. */
const LIMITATION_HEADINGS: Record<GenerationLimitation["kind"], string> = {
  "no-expected-outcome": "Scenarios with no expected outcome",
  "undocumented-status-code": "Responses the specification did not document concretely",
  "unsupported-auth-scheme": "Authentication schemes this export cannot configure",
  "unsupported-content-type": "Request content types this export cannot represent",
  "unresolved-path-parameter": "Path parameters with no approved value",
  "specification-analysis-issue": "Operations carrying specification analysis issues",
  "alternative-auth-requirement-selected": "Operations declaring alternative authentication",
};

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
      <p data-testid="export-limitations-none" className="text-sm text-success-700">
        No limitations recorded: every approved scenario was expressed in full.
      </p>
    );
  }

  const kinds = [...new Set(limitations.map((limitation) => limitation.kind))];

  return (
    <section aria-labelledby="export-limitations-heading" data-testid="export-limitations" className="space-y-2 rounded-md border border-warning-200 bg-warning-50 p-3">
      <h4 id="export-limitations-heading" className="text-sm font-semibold text-warning-700">
        Known limitations ({limitations.length})
      </h4>
      <p className="text-sm text-warning-700">
        These cases could not be expressed in the collection. They are reported rather than
        filled in with an assumed value.
      </p>
      {kinds.map((kind) => {
        const forKind = limitations.filter((limitation) => limitation.kind === kind);
        return (
          <div key={kind} data-testid={`export-limitation-${kind}`}>
            <h5 className="text-xs font-medium uppercase tracking-wide text-warning-700">
              {LIMITATION_HEADINGS[kind]} ({forKind.length})
            </h5>
            <ul className="mt-1 ml-4 list-disc text-sm text-slate-700">
              {forKind.map((limitation, index) => (
                <li key={`${limitation.location}-${limitation.scenarioId ?? index}`}>
                  <code className="font-mono text-xs">{limitation.location}</code>
                  {limitation.scenarioId ? ` (${limitation.scenarioId})` : ""}: {limitation.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}