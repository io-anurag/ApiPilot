import { useState } from "react";
import { guidedPerformanceClient } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { SeedPlanDialog } from "../requestChain/SeedPlanDialog";
import { PerformancePlanScreen } from "./PerformancePlanScreen";

/**
 * The Performance Testing stage (AP-029, specs/031-k6-performance-testing): the guided workflow's
 * framing of the shared performance plan screen. Opening it calls `GET /plan`, which builds the
 * plan and makes this the active stage (contract).
 *
 * AP-037 FR-020 (specs/037-request-chain-performance US4): `onOpenChainPlan` seeds a request-chain
 * plan from the approved workflows and opens it; the plan below is unchanged until phase two.
 */
export function PerformanceTestingStage({ onAdvanced, onOpenChainPlan }: Readonly<{ onAdvanced?: () => void; onOpenChainPlan?: (planId: string) => void }>) {
  const [seeding, setSeeding] = useState(false);
  return (
    <div className="space-y-4">
      {onOpenChainPlan && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-sm text-muted">Prefer to edit every request yourself? Create a request-chain plan from the approved workflows.</p>
          <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setSeeding(true)}>
            Create request-chain plan
          </button>
        </div>
      )}
      {seeding && onOpenChainPlan && (
        <SeedPlanDialog
          source={{ kind: "workflow" }}
          defaultName="Guided workflow plan"
          onCancel={() => setSeeding(false)}
          onSeeded={(planId) => {
            setSeeding(false);
            onOpenChainPlan(planId);
          }}
        />
      )}
    <PerformancePlanScreen
      client={guidedPerformanceClient}
      title="Performance Testing"
      lead={<p>Build a k6 load test from the approved scenarios and workflows. Nothing is sent to any system until you trigger a run.</p>}
      // AP-032 FR-022, FR-023: no scope choice; the plan follows the API review selection.
      scopeNote={() => (
        <p className="text-sm">
          The plan covers the operations selected in API review, or every operation when none were selected. To include others, widen the selection in
          API review and regenerate, or use the quick performance test.
        </p>
      )}
      onAdvanced={onAdvanced}
      testId="performance-testing-stage"
    />
    </div>
  );
}
