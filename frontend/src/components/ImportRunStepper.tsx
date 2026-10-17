import {
  IMPORT_RUN_STEP_HINTS,
  IMPORT_RUN_STEP_LABELS,
  IMPORT_RUN_STEP_ORDER,
  getStepLockReason,
  type ImportRunProgress,
  type ImportRunStepId,
} from "./importRunSteps";
import { StepTrail } from "./patterns/StepTrail";

/**
 * The clickable step indicator for Import & Run Collection, rendered by the shared `StepTrail`
 * (AP-054): Collection, Review requests, Run, Results, each with its hint or lock reason. State is
 * always also text, plus `aria-current` on the open step.
 */
export function ImportRunStepper({
  current,
  progress,
  onSelect,
}: Readonly<{
  current: ImportRunStepId;
  progress: ImportRunProgress;
  onSelect: (stepId: ImportRunStepId) => void;
}>) {
  return (
    <StepTrail
      ariaLabel="Import and run progress"
      testId="import-run-stepper"
      columns={4}
      currentId={current}
      items={IMPORT_RUN_STEP_ORDER.map((stepId) => ({
        id: stepId,
        label: IMPORT_RUN_STEP_LABELS[stepId],
        hint: IMPORT_RUN_STEP_HINTS[stepId],
        lockReason: getStepLockReason(stepId, progress),
        testId: `import-run-step-${stepId}`,
      }))}
      onSelect={(id) => onSelect(id as ImportRunStepId)}
    />
  );
}
