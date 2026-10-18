import { useId, useState } from "react";
import type { GenerationReply, SecurityCategory } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { fetchScope, generateScenarios } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { Banner } from "../patterns/Banner";
import { Card, CardHeader } from "../patterns/Card";
import { Skeleton } from "../Skeleton";

/** What a generation did, as text: counts first, then anything that was rejected, capped or explained. */
function GenerationSummary({ reply }: Readonly<{ reply: GenerationReply }>) {
  const { scope, created, kept, newVersions, rejected, omittedByCap, notes } = reply;
  return (
    <div className="space-y-2 text-sm text-text-secondary" data-testid="generation-summary">
      <p role="status" className="font-medium text-text-primary">
        Generated for {scope.included} {scope.included === 1 ? "operation" : "operations"} ({scope.excluded} left out): {created} created, {kept} kept unchanged, {newVersions}{" "}
        new {newVersions === 1 ? "version" : "versions"}.
      </p>
      {rejected.length > 0 && (
        <div>
          <p className="font-medium text-text-primary">Not stored because they were invalid ({rejected.length}):</p>
          <ul className="list-disc pl-5">
            {rejected.map((entry) => (
              <li key={`${entry.operationKey}-${entry.categoryId}`}>
                <span className="font-mono text-xs">{entry.operationKey}</span>, {entry.categoryId}: {entry.violations.map((violation) => violation.message).join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {omittedByCap.length > 0 && (
        <div>
          <p className="font-medium text-text-primary">Left out to stay within the per-operation limit:</p>
          <ul className="list-disc pl-5">
            {omittedByCap.map((entry) => (
              <li key={`${entry.operationKey}-${entry.categoryId}`}>
                {entry.omitted} for <span className="font-mono text-xs">{entry.operationKey}</span>, {entry.categoryId}
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <div>
          <p className="font-medium text-text-primary">Notes:</p>
          <ul className="list-disc pl-5">
            {notes.map((note) => (
              <li key={`${note.categoryId}-${note.operationKey ?? ""}-${note.reason}`}>
                {note.operationKey && <span className="font-mono text-xs">{note.operationKey}, </span>}
                {note.categoryId}: {note.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The generation scope and the control that generates (specs/057 FR-018, research R23): the guided workflow's
 * selection, or every operation when none was made, and the categories to limit it to. With no specification loaded
 * there is nothing to generate from, so the control is disabled with the reason and the way to proceed, while the
 * retained scenarios below stay readable (FR-004).
 */
export function ScopeBanner({ categories, onGenerated }: Readonly<{ categories: readonly SecurityCategory[]; onGenerated: () => void }>) {
  const scope = useSecurityResource((signal) => fetchScope({ signal }));
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<GenerationReply | null>(null);
  const reasonId = useId();
  const generatable = categories.filter((category) => category.generatable);

  async function generate(mode: "selection" | "all") {
    setGenerating(true);
    setError(null);
    const result = await generateScenarios({ scope: { mode }, ...(chosen.length > 0 ? { categories: [...chosen] } : {}) });
    setGenerating(false);
    if (!result.ok) {
      setReply(null);
      setError(result.message);
      return;
    }
    setReply(result.data);
    onGenerated();
  }

  if (scope.problem?.kind === "no-specification") {
    return (
      <Card as="section" aria-label="Generation scope" data-testid="scope-banner">
        <Banner tone="neutral" title="Generation is unavailable: no specification is loaded" testId="scope-no-specification">
          <span id={reasonId}>
            Scenarios are generated from a specification. Upload one in the Guided Workflow to generate. Scenarios you kept earlier are listed below and stay readable.
          </span>
        </Banner>
        <div className="mt-3">
          <button type="button" disabled aria-describedby={reasonId} className={BUTTON_STYLES.primary}>
            Generate scenarios
          </button>
        </div>
      </Card>
    );
  }

  if (scope.problem?.kind === "error" && !scope.data) {
    return (
      <ErrorState testId="scope-error" message="The generation scope could not be read" detail={`${scope.problem.message} Generation is unavailable until it can.`}>
        <button type="button" onClick={scope.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  }

  if (!scope.data) {
    return (
      <div role="status" aria-label="Reading the generation scope">
        <Skeleton className="h-20 w-full rounded bg-surface-strong" />
      </div>
    );
  }

  const { mode, selectedCount, totalCount } = scope.data;
  const scopeText =
    mode === "selection"
      ? `Generation covers your Guided Workflow selection: ${selectedCount} of ${totalCount} operations.`
      : `Generation covers all ${totalCount} operations: no selection was made in the Guided Workflow.`;

  return (
    <Card as="section" aria-labelledby="scope-heading" data-testid="scope-banner">
      <CardHeader title="Generate scenarios" titleId="scope-heading" subtitle="Deterministic: the same specification always gives the same scenarios." />
      <p className="text-sm text-text-secondary" data-testid="scope-text">
        {scopeText}
      </p>
      {generatable.length > 0 && (
        <fieldset className="mt-3 space-y-1">
          <legend className="text-xs font-medium text-text-secondary">Limit to categories (none ticked means all)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {generatable.map((category) => (
              <label key={category.id} className="flex items-center gap-1.5 text-sm text-text-primary">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-control"
                  checked={chosen.includes(category.id)}
                  onChange={(event) => setChosen((current) => (event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id)))}
                />
                {category.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void generate(mode)} disabled={generating} className={BUTTON_STYLES.primary}>
          {generating ? "Generating..." : "Generate scenarios"}
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorState testId="generation-error" message="Scenarios were not generated" detail={error} />
        </div>
      )}
      {reply && (
        <div className="mt-3">
          <GenerationSummary reply={reply} />
        </div>
      )}
    </Card>
  );
}
