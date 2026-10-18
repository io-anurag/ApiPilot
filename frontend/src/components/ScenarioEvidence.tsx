import type { Assertion, GenerationNote, ScenarioEvidence as ScenarioEvidenceData } from "@apipilot/shared-domain";
import { FactOriginBadge } from "./FactOriginBadge";

/**
 * What a generated scenario rests on when it came from a capture or a definition (specs/056 FR-035,
 * FR-036, FR-043): the origin and the number of observations as text, whether it is an observed
 * replay or an inference, and a plain sentence stating the fact. Nothing is rendered for an OpenAPI
 * scenario, which has no evidence.
 */
export function ScenarioEvidence({ evidence }: Readonly<{ evidence: ScenarioEvidenceData | undefined }>) {
  if (!evidence) return null;
  const derivation =
    evidence.derivation === "inference-derived"
      ? "Inference-derived"
      : evidence.derivation === "declared-example"
        ? "Declared example"
        : "Observed example";
  return (
    <div data-testid="scenario-evidence" className="space-y-1 rounded-lg border border-border bg-surface-subtle p-2.5">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        Evidence
        <FactOriginBadge origin={evidence.origin} observationCount={evidence.observationCount} />
        <span data-testid="scenario-derivation" className="font-medium normal-case tracking-normal text-text-secondary">
          {derivation}
        </span>
      </p>
      <p className="text-sm text-text-secondary">{evidence.summary}</p>
    </div>
  );
}

/** The origin of an asserted fact, as text: nothing for a documented assertion (the unchanged OpenAPI case). */
export function AssertionBasis({ assertion }: Readonly<{ assertion: Assertion }>) {
  if (assertion.basis === undefined || assertion.basis === "documented") return null;
  return (
    <>
      {" "}
      <FactOriginBadge origin={assertion.basis} />
    </>
  );
}

/** Operations that produced no scenario at all, each with the reason (specs/056 FR-040). */
export function GenerationNotes({ notes }: Readonly<{ notes: readonly GenerationNote[] | undefined }>) {
  if (!notes || notes.length === 0) return null;
  return (
    <section data-testid="generation-notes" aria-labelledby="generation-notes-title" className="space-y-1.5 rounded-xl border border-border bg-surface-subtle p-3">
      <h4 id="generation-notes-title" className="text-sm font-semibold text-text-primary">
        {notes.length} {notes.length === 1 ? "operation has" : "operations have"} no generated scenarios
      </h4>
      <p className="text-xs text-text-secondary">
        They stay in the review above and can be selected, but there is not enough evidence to generate a test for them.
      </p>
      <ul className="space-y-1 text-sm text-text-secondary">
        {notes.map((note) => (
          <li key={`${note.operationMethod} ${note.operationPath}`}>
            <span className="break-all font-mono text-xs font-semibold text-text-primary">
              {note.operationMethod} {note.operationPath}
            </span>
            : {note.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
