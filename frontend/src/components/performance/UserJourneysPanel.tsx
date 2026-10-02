import { useState } from "react";
import type { PerformanceJourney, PerformancePlan, UserJourneyDefinition } from "@apipilot/shared-domain";
import type { PerformanceClient, PerformanceErrorResult, PlanUpdate } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { PromptDialog } from "../PromptDialog";
import { StatusBadge } from "../StatusBadge";
import { AddStepDialog } from "./AddStepDialog";
import { BindingSourceControl, type EarlierCapture } from "./BindingSourceControl";
import { CaptureEditor } from "./CaptureEditor";
import { INCOMPLETE_LABEL, journeyOriginLabel, NOT_DOCUMENTED_LABEL, TARGET_MISSING_LABEL } from "./performanceViewModel";
import {
  journeyRefusalText,
  journeysInputOf,
  parameterEditsWithout,
  pathParameterNames,
  renamed,
  targetLabel,
  withBinding,
  withCapture,
  withNewJourney,
  withoutBinding,
  withoutCapture,
  withoutJourney,
  withoutStep,
  withStepAdded,
} from "./userJourneysViewModel";

/**
 * AP-035 (specs/035-user-defined-journeys User Stories 1 to 3; research R16): the engineer's own
 * journeys, on both performance paths. Every change sends the complete list of definitions to the
 * server, which validates it and assigns ids; nothing is changed here first (research R3). ApiPilot
 * never adds a journey, step, capture or binding on its own (FR-006): each control below is an
 * explicit action, and every state is shown as text, not colour alone.
 */
type Apply = (update: PlanUpdate, success?: string, options?: { refusalShownByCaller?: boolean }) => Promise<PerformanceErrorResult | null>;

type Pending =
  | { kind: "new" }
  | { kind: "add-step"; journeyId: string }
  | { kind: "rename"; journey: UserJourneyDefinition }
  | { kind: "delete"; journey: UserJourneyDefinition }
  | { kind: "revert"; journey: UserJourneyDefinition }
  | { kind: "drop-edit"; update: PlanUpdate; parameter: string };

export function UserJourneysPanel({
  plan,
  busy,
  apply,
  guided,
  loadFields,
  loadPreview,
}: Readonly<{
  plan: PerformancePlan;
  busy: boolean;
  apply: Apply;
  /** Editing a proposed workflow journey is on the guided path only (FR-024). */
  guided: boolean;
  loadFields: PerformanceClient["fetchResponseFields"];
  loadPreview: PerformanceClient["fetchStepRequest"];
}>) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const definitions = plan.userJourneys ?? [];
  const inputs = journeysInputOf(definitions);
  const journeysById = new Map(plan.journeys.map((journey) => [journey.id, journey]));
  const operationKeys = [...new Set([...plan.journeys.flatMap((journey) => journey.steps.map((step) => step.operationKey)), ...definitions.flatMap((definition) => definition.steps.map((step) => step.operationKey))])].sort();
  const proposed = plan.journeys.filter((journey): journey is PerformanceJourney & { source: { kind: "workflow"; workflowId: string } } => journey.source.kind === "workflow");
  const standalone = new Set(plan.alsoStandalone ?? []);
  const globalStepLabel = (stepId: string) => plan.journeys.flatMap((journey) => journey.steps).find((step) => step.id === stepId)?.operationKey ?? stepId;

  const send = async (update: PlanUpdate, success: string) => {
    setProblem(null);
    const refused = await apply(update, success, { refusalShownByCaller: true });
    if (refused?.error === "parameter_edited" && refused.stepId && refused.name && update.userJourneys) {
      // FR-014: ask before the binding drops the parameter's edited value.
      setPending({ kind: "drop-edit", parameter: refused.name, update: { ...update, parameterEdits: { [refused.stepId]: parameterEditsWithout(plan, refused.stepId, refused.name) } } });
      return;
    }
    if (refused) setProblem(journeyRefusalText(refused, globalStepLabel) ?? refused.message);
  };

  const stepLabelIn = (definition: UserJourneyDefinition, stepId: string) => {
    const index = definition.steps.findIndex((step) => step.id === stepId);
    return index < 0 ? stepId : `${index + 1} ${definition.steps[index].operationKey}`;
  };

  return (
    <section aria-labelledby="user-journeys-title" className="space-y-3 rounded-md border border-border p-3" data-testid="user-journeys">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 id="user-journeys-title" className="text-sm font-semibold">
            Your journeys
          </h4>
          <p className="text-xs text-muted">
            Run operations in the order you choose, and pass a value one step&apos;s response returns to later steps. Captured values exist only while one virtual user runs one journey,
            and are never shown or recorded.
          </p>
        </div>
        <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={() => setPending({ kind: "new" })}>
          New journey
        </button>
      </div>
      {problem && (
        <p role="alert" className="rounded-md border border-danger-500 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100">
          {problem}
        </p>
      )}

      {guided && proposed.length > 0 && (
        <ul aria-label="Journeys proposed from approved workflows" className="space-y-1 text-sm">
          {proposed.map((journey) => (
            <li key={journey.id} className="flex flex-wrap items-center gap-2">
              <StatusBadge label={journeyOriginLabel(journey.source)} />
              <span className="font-mono text-xs">{journey.steps.map((step) => step.operationKey).join(" → ")}</span>
              <button
                type="button"
                className={BUTTON_STYLES.ghost}
                disabled={busy}
                aria-label={`Edit the journey proposed from workflow ${journey.source.workflowId}`}
                onClick={() => void send({ editProposedJourney: journey.id }, "The proposed journey is now yours to edit.")}
              >
                Edit journey
              </button>
            </li>
          ))}
        </ul>
      )}

      {definitions.length === 0 && <p className="text-sm text-muted">No journeys yet. Choose New journey to compose one from the plan&apos;s operations.</p>}

      {definitions.map((definition) => {
        const journey = journeysById.get(definition.id);
        const resolvedSteps = new Map((journey?.steps ?? []).map((step) => [step.id, step]));
        const journeyKeys = [...new Set(definition.steps.map((step) => step.operationKey))];
        return (
          <article key={definition.id} aria-labelledby={`journey-${definition.id}`} className="space-y-2 rounded-md border border-border bg-chrome p-3 dark:bg-white/5">
            <header className="flex flex-wrap items-center gap-2">
              <h5 id={`journey-${definition.id}`} className="text-sm font-semibold">
                {definition.name}
              </h5>
              <StatusBadge label={journey ? journeyOriginLabel(journey.source) : "Defined by you"} tone="info" />
              {journey?.incompleteReason && (
                <>
                  <StatusBadge label={INCOMPLETE_LABEL} tone="warning" />
                  <span className="text-xs text-muted">Not run until {journey.incompleteReason.missingOperationKeys.join(", ")} is back in the plan.</span>
                </>
              )}
              <span className="ml-auto flex flex-wrap gap-2">
                <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setPending({ kind: "rename", journey: definition })}>
                  Rename
                </button>
                {definition.origin.kind === "based-on-workflow" && guided && (
                  <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setPending({ kind: "revert", journey: definition })}>
                    Revert to proposed journey
                  </button>
                )}
                <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setPending({ kind: "delete", journey: definition })} aria-label={`Delete journey ${definition.name}`}>
                  Delete
                </button>
              </span>
            </header>

            <ol className="space-y-2" aria-label={`Steps of ${definition.name}`}>
              {definition.steps.map((stepDefinition, index) => {
                const resolved = resolvedSteps.get(stepDefinition.id);
                const [method, ...pathParts] = stepDefinition.operationKey.split(" ");
                const earlier: EarlierCapture[] = definition.steps
                  .slice(0, index)
                  .flatMap((earlierStep, earlierIndex) => earlierStep.captures.map((capture) => ({ stepId: earlierStep.id, stepLabel: String(earlierIndex + 1), name: capture.name })));
                const laterParameterNames = definition.steps.slice(index + 1).flatMap((later) => pathParameterNames(later.operationKey));
                const order = definition.steps.map((step) => step.id);
                const moveTo = (to: number) => {
                  const next = [...order];
                  next.splice(index, 1);
                  next.splice(to, 0, stepDefinition.id);
                  void send({ stepOrder: { [definition.id]: next } }, "Step moved.");
                };
                return (
                  <li key={stepDefinition.id} className="space-y-1.5 rounded border border-border bg-surface p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{index + 1}.</span>
                      <HttpMethodBadge method={method} />
                      <span className="font-mono text-sm break-all">{pathParts.join(" ")}</span>
                      {!resolved && <StatusBadge label="Not in the plan" tone="warning" />}
                      <span className="ml-auto flex gap-2">
                        <button type="button" className={BUTTON_STYLES.ghost} disabled={busy || index === 0} onClick={() => moveTo(index - 1)} aria-label={`Move step ${index + 1} up`}>
                          ↑
                        </button>
                        <button
                          type="button"
                          className={BUTTON_STYLES.ghost}
                          disabled={busy || index === definition.steps.length - 1}
                          onClick={() => moveTo(index + 1)}
                          aria-label={`Move step ${index + 1} down`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={BUTTON_STYLES.ghost}
                          disabled={busy || definition.steps.length === 1}
                          onClick={() => void send({ userJourneys: withoutStep(inputs, definition.id, stepDefinition.id) }, "Step removed from the journey.")}
                          aria-label={`Remove step ${index + 1} from ${definition.name}`}
                        >
                          Remove
                        </button>
                      </span>
                    </div>

                    {stepDefinition.captures.length > 0 && (
                      <ul aria-label={`Captures of step ${index + 1}`} className="space-y-0.5 text-xs">
                        {stepDefinition.captures.map((capture) => (
                          <li key={capture.name} className="flex flex-wrap items-center gap-2">
                            <code>{capture.name}</code>
                            <span className="text-muted">← {capture.source.kind === "body" ? `response field ${capture.source.path}` : `response header ${capture.source.name}`}</span>
                            {capture.documented === false && <StatusBadge label={NOT_DOCUMENTED_LABEL} tone="warning" />}
                            <button
                              type="button"
                              className={BUTTON_STYLES.ghost}
                              disabled={busy}
                              onClick={() => void send({ userJourneys: withoutCapture(inputs, definition.id, stepDefinition.id, capture.name) }, "Capture removed.")}
                              aria-label={`Remove capture ${capture.name}`}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {stepDefinition.bindings.length > 0 && (
                      <ul aria-label={`Captured values step ${index + 1} uses`} className="space-y-0.5 text-xs">
                        {stepDefinition.bindings.map((binding) => (
                          <li key={targetLabel(binding.target)} className="flex flex-wrap items-center gap-2">
                            <span>{targetLabel(binding.target)}</span>
                            <span className="text-muted">
                              ← <code>{binding.captureName}</code> from step {stepLabelIn(definition, binding.captureStepId)}
                            </span>
                            {binding.confidence && <StatusBadge label={`${binding.confidence} relationship`} tone="success" />}
                            {binding.state === "target-missing" && <StatusBadge label={TARGET_MISSING_LABEL} tone="danger" />}
                            <button
                              type="button"
                              className={BUTTON_STYLES.ghost}
                              disabled={busy}
                              onClick={() => void send({ userJourneys: withoutBinding(inputs, definition.id, stepDefinition.id, binding.target) }, "The value is no longer filled from a capture.")}
                              aria-label={`Stop filling ${targetLabel(binding.target)} from ${binding.captureName}`}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-brand-700 dark:text-brand-300">Capture or use a value</summary>
                      <div className="mt-2 space-y-2">
                        <CaptureEditor
                          operationKey={stepDefinition.operationKey}
                          laterParameterNames={laterParameterNames}
                          busy={busy}
                          loadFields={loadFields}
                          onAdd={(capture) => void send({ userJourneys: withCapture(inputs, definition.id, stepDefinition.id, capture) }, `Capture ${capture.name} added.`)}
                        />
                        {index > 0 && resolved && (
                          <BindingSourceControl
                            stepId={stepDefinition.id}
                            operationKey={stepDefinition.operationKey}
                            earlierCaptures={earlier}
                            busy={busy}
                            loadPreview={loadPreview}
                            onBind={(binding) => void send({ userJourneys: withBinding(inputs, definition.id, stepDefinition.id, binding) }, "The value now comes from an earlier step.")}
                          />
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setPending({ kind: "add-step", journeyId: definition.id })}>
                + Add step
              </button>
              <fieldset className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <legend className="sr-only">Operations that also run on their own</legend>
                {journeyKeys.map((key) => (
                  <label key={key} className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      className="accent-brand-600"
                      checked={standalone.has(key)}
                      disabled={busy}
                      onChange={(event) => {
                        const next = event.target.checked ? [...standalone, key] : [...standalone].filter((candidate) => candidate !== key);
                        void send({ alsoStandalone: next }, event.target.checked ? `${key} also runs on its own.` : `${key} runs only in journeys.`);
                      }}
                    />
                    Also run <span className="font-mono">{key}</span> on its own
                  </label>
                ))}
              </fieldset>
            </div>
          </article>
        );
      })}

      {pending?.kind === "new" && (
        <AddStepDialog
          title="New journey"
          withName
          operationKeys={operationKeys}
          confirmLabel="Create journey"
          onCancel={() => setPending(null)}
          onConfirm={({ name, operationKey }) => {
            setPending(null);
            void send({ userJourneys: withNewJourney(inputs, name, operationKey) }, `Journey ${name} created. Its operations no longer run on their own.`);
          }}
        />
      )}
      {pending?.kind === "add-step" && (
        <AddStepDialog
          title="Add a step"
          operationKeys={operationKeys}
          confirmLabel="Add step"
          onCancel={() => setPending(null)}
          onConfirm={({ operationKey }) => {
            const journeyId = pending.journeyId;
            setPending(null);
            void send({ userJourneys: withStepAdded(inputs, journeyId, operationKey) }, `${operationKey} added. It no longer runs on its own.`);
          }}
        />
      )}
      {pending?.kind === "rename" && (
        <PromptDialog
          title="Rename journey"
          label="Journey name"
          initialValue={pending.journey.name}
          confirmLabel="Rename"
          onCancel={() => setPending(null)}
          onConfirm={(name) => {
            const journeyId = pending.journey.id;
            setPending(null);
            void send({ userJourneys: renamed(inputs, journeyId, name) }, "Journey renamed.");
          }}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          message={`Delete the journey ${pending.journey.name}? Its operations return as single-step journeys unless they are in another journey.`}
          affectedCount={1}
          confirmLabel="Delete journey"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const journeyId = pending.journey.id;
            setPending(null);
            void send({ userJourneys: withoutJourney(inputs, journeyId) }, "Journey deleted.");
          }}
        />
      )}
      {pending?.kind === "revert" && (
        <ConfirmDialog
          message={revertMessage(pending.journey)}
          affectedCount={1}
          confirmLabel="Revert"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const journeyId = pending.journey.id;
            setPending(null);
            void send({ revertProposedJourney: journeyId }, "The proposed journey is back.");
          }}
        />
      )}
      {pending?.kind === "drop-edit" && (
        <ConfirmDialog
          message={`${pending.parameter} has an edited value. Filling it from a captured value drops that edited value. Continue?`}
          affectedCount={1}
          confirmLabel="Use captured value"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const update = pending.update;
            setPending(null);
            void send(update, "The value now comes from an earlier step; its edited value was dropped.");
          }}
        />
      )}
    </section>
  );
}

/** FR-024 (Clarifications 2026-10-02): the revert confirmation names the steps whose settings are discarded. */
export function revertMessage(definition: UserJourneyDefinition): string {
  const added = definition.steps.filter((step) => !step.fromProposedStepId).map((step) => step.operationKey);
  return added.length === 0
    ? "Revert to the proposed journey? The workflow's steps keep their expected statuses and edits."
    : `Revert to the proposed journey? The workflow's steps keep their expected statuses and edits. The settings of the steps you added are discarded: ${added.join(", ")}.`;
}
