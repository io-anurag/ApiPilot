import { PATH_STEPS, STEP_HINTS, isStepSelectable, isStepSkipped, stepLabel, type PathStep, type SourceKind } from "./pathState";
import { StepTrail } from "../../patterns/StepTrail";

/** Why a step cannot be opened; `undefined` when it can. State is always text, never colour alone. */
export function stepLockReason(step: PathStep, reached: number, source: SourceKind | null): string | undefined {
  if (isStepSkipped(step, source)) return "Skipped for an empty plan";
  if (!isStepSelectable(step, reached, source)) return "Finish the earlier steps first";
  return undefined;
}

/**
 * The Performance path's clickable step indicator (specs/047-unified-performance-tab FR-006),
 * rendered by the shared `StepTrail` (AP-054): a hint or the lock reason under each label and
 * `aria-current="step"` on the open step. Reached steps can be selected, so the engineer can jump
 * back, or straight to Load or Run on an opened plan.
 */
export function PerformanceStepper({
  current,
  reached,
  source,
  onSelect,
}: Readonly<{ current: PathStep; reached: number; source: SourceKind | null; onSelect: (step: PathStep) => void }>) {
  return (
    <StepTrail
      ariaLabel="Performance test progress"
      testId="performance-stepper"
      columns={5}
      currentId={current}
      items={PATH_STEPS.map((step) => ({
        id: step,
        label: stepLabel(step, source),
        hint: STEP_HINTS[step],
        lockReason: stepLockReason(step, reached, source),
        testId: `performance-step-${step}`,
      }))}
      onSelect={(id) => onSelect(id as PathStep)}
    />
  );
}
