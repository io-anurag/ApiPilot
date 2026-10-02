import { useEffect, useId, useState } from "react";
import type { BindingTarget, StepRequestPreview } from "@apipilot/shared-domain";
import type { PerformanceClient } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { bodyFieldPaths } from "./userJourneysViewModel";

/**
 * AP-035 FR-011: "Value captured by an earlier step" for one target of a step: a path, query or
 * header parameter the step sends, or a field of its body. Only captures of earlier steps of the
 * same journey are offered (FR-011, FR-015). The targets come from the step's own request preview,
 * so they are what the specification documents for it.
 */
export interface EarlierCapture {
  stepId: string;
  stepLabel: string;
  name: string;
}

export function BindingSourceControl({
  stepId,
  operationKey,
  earlierCaptures,
  busy,
  loadPreview,
  onBind,
}: Readonly<{
  stepId: string;
  operationKey: string;
  earlierCaptures: readonly EarlierCapture[];
  busy: boolean;
  loadPreview: PerformanceClient["fetchStepRequest"];
  onBind: (binding: { target: BindingTarget; captureStepId: string; captureName: string }) => void;
}>) {
  const id = useId();
  const [preview, setPreview] = useState<StepRequestPreview | null>(null);
  const [targetKey, setTargetKey] = useState("");
  const [captureKey, setCaptureKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadPreview(stepId).then((result) => {
      if (!cancelled && result.ok) setPreview(result.request);
    });
    return () => {
      cancelled = true;
    };
  }, [loadPreview, stepId]);

  if (earlierCaptures.length === 0) {
    return <p className="text-xs text-muted">No earlier step of this journey captures a value yet.</p>;
  }
  const targets: { key: string; label: string; target: BindingTarget }[] = [
    ...(preview?.parameters ?? []).map((parameter) => ({
      key: `${parameter.location}:${parameter.name}`,
      label: `${parameter.location} parameter ${parameter.name}`,
      target: { kind: parameter.location, name: parameter.name } as BindingTarget,
    })),
    ...bodyFieldPaths(preview?.bodyEdit?.kind === "json" ? preview.bodyEdit.text : undefined).map((fieldPath) => ({
      key: `body:${fieldPath}`,
      label: `body field ${fieldPath}`,
      target: { kind: "body", fieldPath } as BindingTarget,
    })),
  ];
  const target = targets.find((candidate) => candidate.key === targetKey) ?? targets[0];
  const capture = earlierCaptures.find((candidate) => `${candidate.stepId}:${candidate.name}` === captureKey) ?? earlierCaptures[0];

  return (
    <form
      aria-label={`Fill a value of ${operationKey} from an earlier step`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (target && capture && !busy) onBind({ target: target.target, captureStepId: capture.stepId, captureName: capture.name });
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-muted" htmlFor={`${id}-target`}>
        Target
        <select
          id={`${id}-target`}
          value={target?.key ?? ""}
          onChange={(event) => setTargetKey(event.target.value)}
          disabled={targets.length === 0}
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
        >
          {targets.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted" htmlFor={`${id}-capture`}>
        Value captured by an earlier step
        <select
          id={`${id}-capture`}
          value={capture ? `${capture.stepId}:${capture.name}` : ""}
          onChange={(event) => setCaptureKey(event.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
        >
          {earlierCaptures.map((candidate) => (
            <option key={`${candidate.stepId}:${candidate.name}`} value={`${candidate.stepId}:${candidate.name}`}>
              {`${candidate.name} (step ${candidate.stepLabel})`}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={BUTTON_STYLES.secondary} disabled={busy || !target}>
        Use captured value
      </button>
      {preview && targets.length === 0 && <p className="basis-full text-xs text-muted">This step sends no parameter or body field to fill.</p>}
    </form>
  );
}
