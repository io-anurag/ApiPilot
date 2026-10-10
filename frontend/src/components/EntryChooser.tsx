import { EntryIllustration } from "./EntryIllustration";
import { ArtifactProductIcon, WorkflowIcon } from "./WorkflowIcon";
import {
  ARTIFACT_CHOICES,
  WORKFLOWS,
  workflowById,
  type EntryChoice,
} from "./workflowCatalog";

export type { EntryChoice } from "./workflowCatalog";

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function ArrowIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4m0-4h.01" />
    </svg>
  );
}

/**
 * The very first thing a user sees (AP-038, Design A "Artifact hero"): a compact hero whose
 * artifact choices (borrowed from Design C) point each kind of input at the workflows that accept
 * it, then the five top-level workflows as equal, colour-coded cards. Shown only until a choice is
 * made — after that the top tab menu takes over navigation (App.tsx).
 *
 * Every control calls the same `onSelect`, so a workflow opened from its artifact, its card, its
 * tab or the command palette ends up in exactly the same state (FR-009, FR-019). Cards keep the
 * workflow title as their whole accessible name; artifact controls append the artifact ("…, for a
 * k6 script") so a by-name lookup of a workflow still finds exactly one button (research.md D9).
 *
 * Spacing follows Design A's proportions rather than squeezing everything above the fold: the
 * user found the compact version crammed, so at a 1366 × 768 window the workflow section starts
 * in the first screen and the cards continue below it (FR-012 as amended, research.md D10).
 */
export function EntryChooser({
  onSelect,
}: Readonly<{ onSelect: (choice: EntryChoice) => void }>) {
  return (
    <div data-testid="entry-chooser" className="space-y-12 py-2 lg:py-6">
      <section aria-label="Start from an artifact" className="space-y-8">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_32rem]">
          <div className="space-y-5">
            <p className="inline-flex items-center gap-2 rounded-sm bg-brand-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-widest text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
              <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-brand-500" />
              API test engineering workspace
            </p>
            <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-text-primary sm:text-5xl">
              Start with the{" "}
              <span className="text-brand-600 dark:text-brand-300">artifact</span>
              <br className="hidden sm:block" /> you have.
            </h2>
            <p className="max-w-xl text-lg leading-8 text-muted">
              Build an explainable test suite from an OpenAPI specification, or go
              straight to running a Postman collection, a quick load test, or a k6 script
              of your own.
            </p>
          </div>

          <EntryIllustration />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {ARTIFACT_CHOICES.map((artifact) => (
            <fieldset
              key={artifact.id}
              className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-sm"
            >
              <legend className="float-left flex w-full items-center gap-2.5 text-sm font-semibold text-text-primary">
                <ArtifactProductIcon name={artifact.icon} className="h-5 w-5 shrink-0" />
                {artifact.label}
              </legend>
              <div className="clear-left flex flex-wrap gap-2 pt-3">
                {artifact.workflows.map((id) => {
                  const workflow = workflowById(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={`${workflow.title}, for ${artifact.phrase}`}
                      onClick={() => onSelect(id)}
                      className={`inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-text-secondary motion-safe:transition-colors hover:text-text-primary ${workflow.tone.border} ${FOCUS_RING}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-sm ${workflow.tone.marker}`}
                      />
                      {workflow.title}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section aria-labelledby="entry-paths-heading" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted">Choose a workflow</p>
            <h2
              id="entry-paths-heading"
              className="font-display text-2xl font-bold tracking-tight text-text-primary"
            >
              Launch a test session
            </h2>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <InfoIcon />
            Your work remains available for this browser session.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {WORKFLOWS.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              aria-label={workflow.title}
              aria-describedby={`entry-${workflow.id}-description`}
              onClick={() => onSelect(workflow.id)}
              className={`group flex min-h-60 flex-col items-start gap-3 rounded-xl border p-5 text-left motion-safe:transition-colors ${
                workflow.recommended
                  ? "border-border-strong bg-surface shadow-md"
                  : "border-border bg-surface shadow-sm"
              } ${workflow.tone.border} ${FOCUS_RING}`}
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border ${workflow.tone.tile}`}
                >
                  <WorkflowIcon name={workflow.icon} className="h-6 w-6" />
                </span>
                {workflow.recommended && (
                  <span className="rounded-sm border border-border-strong bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                    Recommended
                  </span>
                )}
              </span>
              <span className="mt-1 font-display text-base font-bold text-text-primary">
                {workflow.title}
              </span>
              <span
                id={`entry-${workflow.id}-description`}
                className="hyphens-auto text-justify text-sm leading-6 text-muted"
              >
                {workflow.description}
              </span>
              <span
                aria-hidden="true"
                className={`mt-auto flex h-9 w-9 items-center justify-center self-end rounded-full ${workflow.tone.action} motion-safe:transition-transform group-hover:translate-x-0.5`}
              >
                <ArrowIcon className="h-4 w-4" />
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
