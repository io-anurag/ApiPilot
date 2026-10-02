import { useEffect, useId, useState } from "react";
import { collectionStepLabel, type PerformancePlan, type PreviewReference } from "@apipilot/shared-domain";
import type { PerformanceClient, PerformanceErrorResult, PlanUpdate } from "../../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../../controlStyles";
import { StatusBadge } from "../../StatusBadge";
import { CaptureEditor } from "../CaptureEditor";
import { captureOriginText, NOT_DOCUMENTED_IN_A_SPECIFICATION_LABEL } from "../performanceViewModel";

/**
 * AP-036 FR-019 (specs/036-collection-performance-test research R20): where a value was not
 * recognised, the engineer adds the capture on that step and binds it on later steps, as in a
 * user-defined journey. A collection documents no response fields, so any path is typed and labelled
 * "Not documented in a specification". Names only; no value is ever shown.
 */
const NO_FIELDS_TEXT = `A collection documents no response fields. A path you type is accepted, labelled "${NOT_DOCUMENTED_IN_A_SPECIFICATION_LABEL}".`;
const noFields = () => Promise.resolve({ ok: true as const, fields: [], truncated: false });

interface Request {
  id: string;
  label: string;
}

function requestsOf(plan: PerformancePlan): Request[] {
  return [
    ...(plan.collection?.credentialRequests ?? []).map((request) => ({ id: request.stepId, label: collectionStepLabel(request.request) })),
    ...plan.journeys.flatMap((journey) => journey.steps).map((step) => ({ id: step.id, label: step.collectionRequest ? collectionStepLabel(step.collectionRequest) : step.operationKey })),
  ];
}

function capturesOf(plan: PerformancePlan, stepId: string) {
  const step = plan.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.id === stepId);
  return step?.captures ?? plan.collection?.credentialRequests.find((request) => request.stepId === stepId)?.captures ?? [];
}

function environmentNames(references: readonly PreviewReference[]): string[] {
  const names = references.flatMap((reference) => (reference.kind === "environment" && reference.name !== "baseUrl" && !reference.name.startsWith("apipilot_") ? [reference.name] : []));
  return [...new Set(names)].sort();
}

/** The environment references of a step's request, which an earlier capture may fill instead. */
function ReferenceBindingControl({
  stepId,
  label,
  earlier,
  busy,
  loadPreview,
  onBind,
}: Readonly<{
  stepId: string;
  label: string;
  earlier: { stepId: string; stepLabel: string; name: string }[];
  busy: boolean;
  loadPreview: PerformanceClient["fetchStepRequest"];
  onBind: (binding: { name: string; captureStepId: string; captureName: string }) => void;
}>) {
  const id = useId();
  const [names, setNames] = useState<string[] | null>(null);
  const [name, setName] = useState("");
  const [capture, setCapture] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadPreview(stepId).then((result) => {
      if (cancelled || !result.ok) return;
      const { request } = result;
      setNames(
        environmentNames([
          ...request.parameters.flatMap((parameter) => {
            if (parameter.value.kind === "template") return parameter.value.references;
            return parameter.value.kind === "generated" ? [] : [parameter.value];
          }),
          ...request.auth.references,
          ...(request.body?.references ?? []),
        ]),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [loadPreview, stepId]);

  if (names === null) return <p className="text-xs text-muted">Reading the step&apos;s request…</p>;
  if (names.length === 0) return <p className="text-xs text-muted">This step takes no value from the environment that an earlier capture could fill.</p>;
  if (earlier.length === 0) return <p className="text-xs text-muted">No earlier step captures a value yet.</p>;
  const chosenName = names.includes(name) ? name : names[0];
  const chosen = earlier.find((candidate) => `${candidate.stepId}:${candidate.name}` === capture) ?? earlier[0];
  return (
    <form
      aria-label={`Fill a value of ${label} from an earlier capture`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onBind({ name: chosenName, captureStepId: chosen.stepId, captureName: chosen.name });
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-muted" htmlFor={`${id}-reference`}>
        Reference
        <select
          id={`${id}-reference`}
          value={chosenName}
          onChange={(event) => setName(event.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
        >
          {names.map((candidate) => (
            <option key={candidate} value={candidate}>{`{{${candidate}}}`}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted" htmlFor={`${id}-capture`}>
        Value captured by an earlier step
        <select
          id={`${id}-capture`}
          value={`${chosen.stepId}:${chosen.name}`}
          onChange={(event) => setCapture(event.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
        >
          {earlier.map((candidate) => (
            <option key={`${candidate.stepId}:${candidate.name}`} value={`${candidate.stepId}:${candidate.name}`}>
              {`${candidate.name} (${candidate.stepLabel})`}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={BUTTON_STYLES.secondary} disabled={busy}>
        Use captured value
      </button>
    </form>
  );
}

export function CollectionCapturesPanel({
  plan,
  busy,
  apply,
  loadPreview,
}: Readonly<{
  plan: PerformancePlan;
  busy: boolean;
  apply: (update: PlanUpdate, success?: string) => Promise<PerformanceErrorResult | null>;
  loadPreview: PerformanceClient["fetchStepRequest"];
}>) {
  const requests = requestsOf(plan);
  const [selected, setSelected] = useState(requests[0]?.id ?? "");
  if (!plan.collection || requests.length === 0) return null;
  const current = requests.find((request) => request.id === selected) ?? requests[0];
  const index = requests.indexOf(current);
  const captures = capturesOf(plan, current.id);
  const userCaptures = captures.filter((capture) => capture.origin?.kind === "user");
  const toInput = (list: typeof userCaptures) =>
    list.map((capture) => ({
      name: capture.name,
      source: capture.source.kind === "body" ? { kind: "body" as const, path: capture.source.path } : { kind: "header" as const, name: capture.source.name },
    }));
  const bindings = plan.collection.addedBindings.filter((binding) => binding.stepId === current.id);
  const bindingInputs = (list: typeof bindings) => list.map(({ name, captureStepId, captureName }) => ({ name, captureStepId, captureName }));
  const earlier = requests.slice(0, index).flatMap((request) => capturesOf(plan, request.id).map((capture) => ({ stepId: request.id, stepLabel: request.label, name: capture.name })));
  const labelOf = (stepId: string) => requests.find((request) => request.id === stepId)?.label ?? stepId;

  return (
    <section aria-labelledby="collection-captures-title" className="space-y-3 rounded-md border border-border p-3" data-testid="collection-captures-panel">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4 id="collection-captures-title" className="text-sm font-semibold">
            Captures you add
          </h4>
          <p className="text-xs text-muted">Where a script set a value ApiPilot did not recognise, capture it here and use it on later steps.</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Step
          <select
            value={current.id}
            onChange={(event) => setSelected(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
          >
            {requests.map((request) => (
              <option key={request.id} value={request.id}>
                {request.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="space-y-1 text-sm" aria-label={`Captures of ${current.label}`}>
        {captures.length === 0 && <li className="text-xs text-muted">This step captures nothing.</li>}
        {captures.map((capture) => (
          <li key={capture.name} className="flex flex-wrap items-center gap-1.5">
            <code className="font-mono text-xs">{capture.name}</code>
            <span className="text-xs text-muted">
              ← {capture.source.kind === "body" ? `response field ${capture.source.path}` : `response header ${capture.source.name}`} · {captureOriginText(capture)}
            </span>
            {capture.documented === false && <StatusBadge label={NOT_DOCUMENTED_IN_A_SPECIFICATION_LABEL} tone="warning" />}
            {capture.origin?.kind === "user" && (
              <button
                type="button"
                className={BUTTON_STYLES.ghost}
                disabled={busy}
                aria-label={`Remove the capture ${capture.name}`}
                onClick={() => void apply({ addedCaptures: { [current.id]: toInput(userCaptures.filter((other) => other.name !== capture.name)) } }, `Capture ${capture.name} removed.`)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <CaptureEditor
        operationKey={current.label}
        laterParameterNames={[]}
        busy={busy}
        loadFields={noFields}
        noFieldsText={NO_FIELDS_TEXT}
        onAdd={(capture) => void apply({ addedCaptures: { [current.id]: [...toInput(userCaptures), capture] } }, `Capture ${capture.name} added.`)}
      />

      <div className="space-y-1 border-t border-border pt-3">
        <h5 className="text-xs font-semibold">Values you bound</h5>
        {bindings.length === 0 ? (
          <p className="text-xs text-muted">None. A reference with the same name as an earlier capture is bound to it already.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {bindings.map((binding) => (
              <li key={binding.name} className="flex flex-wrap items-center gap-1.5">
                <code className="font-mono">{`{{${binding.name}}}`}</code>
                <span className="text-muted">
                  ← captured {binding.captureName}, from {labelOf(binding.captureStepId)} · set by you
                </span>
                <button
                  type="button"
                  className={BUTTON_STYLES.ghost}
                  disabled={busy}
                  aria-label={`Stop filling {{${binding.name}}} from ${binding.captureName}`}
                  onClick={() =>
                    void apply(
                      { addedBindings: { [current.id]: bindingInputs(bindings.filter((other) => other.name !== binding.name)) } },
                      `{{${binding.name}}} is a value from the environment again.`,
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <ReferenceBindingControl
          key={current.id}
          stepId={current.id}
          label={current.label}
          earlier={earlier}
          busy={busy}
          loadPreview={loadPreview}
          onBind={(binding) =>
            void apply(
              { addedBindings: { [current.id]: [...bindingInputs(bindings.filter((other) => other.name !== binding.name)), binding] } },
              `{{${binding.name}}} now uses the captured ${binding.captureName}.`,
            )
          }
        />
      </div>
    </section>
  );
}
