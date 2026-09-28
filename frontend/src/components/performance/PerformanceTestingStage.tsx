import { guidedPerformanceClient } from "../../services/performanceTestingClient";
import { PerformancePlanScreen } from "./PerformancePlanScreen";

/**
 * The Performance Testing stage (AP-029, specs/031-k6-performance-testing): the guided workflow's
 * framing of the shared performance plan screen. Opening it calls `GET /plan`, which builds the
 * plan and makes this the active stage (contract).
 */
export function PerformanceTestingStage({ onAdvanced }: Readonly<{ onAdvanced?: () => void }>) {
  return (
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
  );
}
