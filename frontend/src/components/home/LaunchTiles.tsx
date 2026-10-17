import { ARTIFACT_CHOICES, WORKFLOWS, workflowById, type EntryChoice } from "../workflowCatalog";
import { ArtifactProductIcon, WorkflowIcon } from "../WorkflowIcon";
import { Card } from "../patterns/Card";
import { Pill } from "../patterns/Pill";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

/**
 * Home's launch tiles (AP-054 FR-018): the three artifacts an engineer may already hold, each
 * leading to the workflows that accept it, and the four workflows. Accessible names are unchanged
 * from the start screen: a workflow tile is named by its title alone, an artifact control by
 * "{title}, for {artifact phrase}". The Performance tile says in words when a draft is unfinished.
 */
export function LaunchTiles({
  onSelect,
  performanceDraft,
}: Readonly<{ onSelect: (choice: EntryChoice) => void; performanceDraft: boolean }>) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="home-artifacts-heading" className="space-y-3">
        <h2 id="home-artifacts-heading" className="text-sm font-semibold text-text-secondary">
          Start with the artifact you have
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {ARTIFACT_CHOICES.map((artifact) => (
            <Card as="div" key={artifact.id} className="space-y-3">
              <div role="group" aria-label={artifact.label} className="space-y-3">
                <p className="flex items-center gap-2.5 text-sm font-semibold text-text-primary">
                  <ArtifactProductIcon name={artifact.icon} className="h-5 w-5 shrink-0" />
                  {artifact.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {artifact.workflows.map((id) => {
                    const workflow = workflowById(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-label={`${workflow.title}, for ${artifact.phrase}`}
                        onClick={() => onSelect(id)}
                        className={`inline-flex items-center gap-2 rounded-lg border border-border-control bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary ${FOCUS}`}
                      >
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm bg-brand-500" />
                        {workflow.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="home-workflows-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="home-workflows-heading" className="font-display text-xl font-bold text-text-primary">
            Launch a test session
          </h2>
          <p className="text-sm text-muted">Your work remains available for this browser session.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {WORKFLOWS.map((workflow) => {
            const draft = workflow.id === "performance" && performanceDraft;
            const describedBy = draft ? `home-${workflow.id}-description home-${workflow.id}-draft` : `home-${workflow.id}-description`;
            return (
              <button
                key={workflow.id}
                type="button"
                aria-label={workflow.title}
                aria-describedby={describedBy}
                onClick={() => onSelect(workflow.id)}
                className={`group flex min-h-48 flex-col items-start gap-3 rounded-2xl border bg-surface p-5 text-left shadow-sm motion-safe:transition-colors hover:bg-surface-hover ${
                  workflow.recommended ? "border-brand-500 bg-lime-pale hover:bg-lime-pale" : "border-border hover:border-brand-500"
                } ${FOCUS}`}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-on-accent">
                    <WorkflowIcon name={workflow.icon} className="h-5 w-5" />
                  </span>
                  {workflow.recommended && <Pill tone="mint">Recommended</Pill>}
                </span>
                <span className="font-display text-base font-bold text-text-primary">{workflow.title}</span>
                <span id={`home-${workflow.id}-description`} className="text-sm leading-6 text-text-secondary">
                  {workflow.description}
                </span>
                {draft && (
                  <span id={`home-${workflow.id}-draft`}>
                    <Pill tone="warn">Draft in progress</Pill>
                  </span>
                )}
                <span aria-hidden="true" className="mt-auto flex items-center gap-1.5 self-end text-sm font-semibold text-brand-700 dark:text-brand-300">
                  <Arrow />
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
