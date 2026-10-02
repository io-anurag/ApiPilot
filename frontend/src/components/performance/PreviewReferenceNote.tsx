import type { PreviewReference } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";

/**
 * Where a `{{name}}` in a step's request gets its value at run time (AP-032 FR-008), in the words
 * the request preview and the body editor (AP-033 FR-009) share. Never shows a value.
 */
export function referenceText(reference: PreviewReference, stepLabel: (stepId: string) => string): string {
  switch (reference.kind) {
    case "environment":
      return `from environment: ${reference.name}`;
    case "workflow-variable":
      return reference.producerStepId ? `from step ${stepLabel(reference.producerStepId)}` : `from variable ${reference.variable}`;
    case "unique-per-iteration":
      return `unique per virtual user and iteration (${reference.format})`;
    case "credential":
      return `token acquired by the plan (${reference.schemeName})`;
    case "capture":
      // AP-035 FR-012: the capture's name and step, never a value.
      return `from captured value ${reference.captureName} (step ${stepLabel(reference.producerStepId)})`;
    case "generated-value":
      // AP-036 FR-013: a Postman dynamic variable, generated for each virtual user and iteration.
      return `generated at run time (${reference.variable})`;
  }
}

export function ReferenceNote({ reference, stepLabel }: Readonly<{ reference: PreviewReference; stepLabel: (stepId: string) => string }>) {
  return (
    <span className="text-xs text-muted">
      {referenceText(reference, stepLabel)}
      {(reference.kind === "environment" || reference.kind === "capture") && reference.secret && (
        <>
          {" "}
          <StatusBadge label="secret" />
        </>
      )}
    </span>
  );
}
