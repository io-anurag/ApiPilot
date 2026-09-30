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
  }
}

export function ReferenceNote({ reference, stepLabel }: Readonly<{ reference: PreviewReference; stepLabel: (stepId: string) => string }>) {
  return (
    <span className="text-xs text-muted">
      {referenceText(reference, stepLabel)}
      {reference.kind === "environment" && reference.secret && (
        <>
          {" "}
          <StatusBadge label="secret" />
        </>
      )}
    </span>
  );
}
