import { useId } from "react";
import { ARTIFACT_CHOICES, RESULTS_VIEWS, WORKFLOWS, workflowById, type ArtifactChoice, type EntryChoice } from "../workflowCatalog";
import { formatRoute, type Route } from "../../navigation/routes";
import { ArtifactProductIcon, WorkflowActionIcon } from "../WorkflowIcon";
import { Pill } from "../patterns/Pill";
import { StepHeading } from "./StepHeading";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Arrow({ className = "h-4 w-4" }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

/** The results screens a person can open from Home: the same entries the sidebar lists. */
export function ResultsLinks({ onOpen }: Readonly<{ onOpen: (route: Route) => void }>) {
  return (
    <>
      {RESULTS_VIEWS.map((view) => {
        const route: Route = { view: view.id };
        return (
          <a
            key={view.id}
            href={formatRoute(route)}
            onClick={(event) => {
              event.preventDefault();
              onOpen(route);
            }}
            className={`font-semibold text-brand-700 hover:underline ${FOCUS}`}
          >
            {view.tabLabel}
          </a>
        );
      })}
    </>
  );
}

/** A workflow an artifact feeds, as the small tag on its card. */
function WorkflowChip({ title }: Readonly<{ title: string }>) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text-secondary">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />
      {title}
    </span>
  );
}

const CARD_HOVER = "motion-safe:transition-colors hover:border-brand-500";

function ArtifactCard({ artifact, onSelect }: Readonly<{ artifact: ArtifactChoice; onSelect: (choice: EntryChoice) => void }>) {
  const icon = <ArtifactProductIcon name={artifact.icon} className="h-16 w-16 shrink-0" />;
  const title = <span className="block font-display text-sm font-bold text-text-primary">{artifact.label}</span>;
  const [only, ...others] = artifact.workflows;
  // One workflow accepts the artifact: the whole card starts it, and the arrow at the end of its tag says so. Several: each tag is its own choice.
  if (others.length === 0) {
    const workflow = workflowById(only);
    return (
      <li className="flex">
        <button
          type="button"
          aria-label={`Start ${workflow.title} with ${artifact.phrase}`}
          onClick={() => onSelect(only)}
          className={`flex w-full items-center gap-4 rounded-2xl border border-border bg-surface p-4 text-left shadow-sm ${CARD_HOVER} ${FOCUS}`}
        >
          {icon}
          <span className="min-w-0 flex-1 space-y-2">
            {title}
            <span className="flex items-center justify-between gap-2">
              <WorkflowChip title={workflow.title} />
              <Arrow className="h-5 w-5 text-brand-700" />
            </span>
          </span>
        </button>
      </li>
    );
  }
  return (
    <li className="flex">
      <div role="group" aria-label={artifact.label} className="flex w-full items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        {icon}
        <div className="min-w-0 flex-1 space-y-2">
          {title}
          <ul className="flex flex-wrap gap-2">
            {artifact.workflows.map((id) => {
              const workflow = workflowById(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-label={`Start ${workflow.title} with ${artifact.phrase}`}
                    onClick={() => onSelect(id)}
                    className={`inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text-secondary ${CARD_HOVER} hover:text-text-primary ${FOCUS}`}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                    {workflow.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </li>
  );
}

/**
 * Step 1 (AP-059 FR-003): what an engineer already holds, and which workflows accept it. Each workflow is named by what it
 * starts and from what, so it is distinct from the tile it also has in step 2.
 */
export function ArtifactStep({ onSelect }: Readonly<{ onSelect: (choice: EntryChoice) => void }>) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <StepHeading number={1} title="Start with the artifact you have" titleId={titleId} description="Choose an API artifact to get started. ApiPilot will analyze it and prepare everything for test generation." />
      <ul className="grid gap-4 sm:grid-cols-3">
        {ARTIFACT_CHOICES.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Step 2 (AP-059 FR-004): the four workflows in the order the sidebar lists them, an arrow between neighbours where
 * there is room. "Recommended" is said once, in the header, and the Guided Workflow tile is described by it; an
 * unfinished Performance draft is said in words on its tile.
 */
export function LaunchStep({
  onSelect,
  performanceDraft,
}: Readonly<{ onSelect: (choice: EntryChoice) => void; performanceDraft: boolean }>) {
  const titleId = useId();
  const recommendedId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <StepHeading
        number={2}
        title="Launch a test session"
        titleId={titleId}
        description="Pick the best experience for your goal. Each option configures and runs a test session using the selected artifact."
        actions={
          <span id={recommendedId}>
            <Pill
              tone="accent"
              icon={
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3">
                  <path d="m12 2 2.6 6.4L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.6z" />
                </svg>
              }
            >
              Recommended
            </Pill>
          </span>
        }
      />
      <ul className="grid gap-x-3 gap-y-10 pt-6 sm:grid-cols-2 xl:flex xl:items-stretch xl:gap-0">
        {WORKFLOWS.map((workflow, index) => {
          const draft = workflow.id === "performance" && performanceDraft;
          const describedBy = [`home-${workflow.id}-description`, ...(workflow.recommended ? [recommendedId] : []), ...(draft ? [`home-${workflow.id}-draft`] : [])].join(" ");
          return (
            <li key={workflow.id} className="flex xl:flex-1 xl:items-center">
              {index > 0 && (
                <span aria-hidden="true" className="hidden px-2 xl:flex">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/25 text-brand-700">
                    <Arrow className="h-4 w-4" />
                  </span>
                </span>
              )}
              <span className="relative flex h-full w-full">
                {workflow.recommended && (
                  <span aria-hidden="true" className="absolute inset-y-3 -left-2 right-3 rounded-2xl border border-brand-500/60 bg-lime-pale" />
                )}
                <button
                  type="button"
                  aria-label={workflow.title}
                  aria-describedby={describedBy}
                  onClick={() => onSelect(workflow.id)}
                  className={`relative flex h-full w-full flex-col items-start gap-2 rounded-2xl border p-4 pt-10 text-left motion-safe:transition-colors ${
                    workflow.recommended ? "border-brand-500 bg-lime-pale shadow-md" : "border-border bg-surface shadow-sm hover:border-brand-500"
                  } ${FOCUS}`}
                >
                  {/* The icon sits on the tile's top edge; its halo, the colour of the page, cuts a round notch into the border. */}
                  <span aria-hidden="true" className="absolute -top-8 left-2.5 rounded-full bg-background p-1.5">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent ring-4 ring-accent/30">
                      <WorkflowActionIcon name={workflow.icon} className="h-6 w-6" />
                    </span>
                  </span>
                  <span className="font-display text-sm font-bold text-text-primary">{workflow.title}</span>
                  <span id={`home-${workflow.id}-description`} className="text-xs leading-5 text-text-secondary">
                    {workflow.description}
                  </span>
                  {draft && (
                    <span id={`home-${workflow.id}-draft`}>
                      <Pill tone="warn">Draft in progress</Pill>
                    </span>
                  )}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
