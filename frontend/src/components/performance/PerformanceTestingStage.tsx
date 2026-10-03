import { SeedFromSource } from "../requestChain/SeededPlans";

/**
 * The Performance Testing stage (AP-029, specs/031-k6-performance-testing). Since AP-037 phase two
 * (specs/037-request-chain-performance US5, FR-036) the guided plan is retired: the stage seeds a
 * request-chain plan from the approved workflows, or opens one seeded before, and the plan is built,
 * run and reported in Performance Plans.
 */
export function PerformanceTestingStage({ onOpenChainPlan }: Readonly<{ onOpenChainPlan: (planId: string) => void }>) {
  return (
    <SeedFromSource
      source={{ kind: "workflow" }}
      seedKind="workflow"
      title="Performance Testing"
      lead={
        <p>
          Create a request-chain plan from the approved workflows: one chain per workflow with its values passed between steps, and one step for each other
          operation. You then edit every request yourself. Nothing is sent to any system until you trigger a run.
        </p>
      }
      defaultName="Guided workflow plan"
      onOpenChainPlan={onOpenChainPlan}
      testId="performance-testing-stage"
    />
  );
}
