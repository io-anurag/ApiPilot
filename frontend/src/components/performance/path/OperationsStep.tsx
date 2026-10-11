import { toOperationKey, type QuickPerformanceTestView } from "@apipilot/shared-domain";
import type { GuidedWorkflowSummary } from "../../../hooks/useGuidedWorkflowSummary";
import { ErrorState } from "../../ErrorState";
import { OperationSelection } from "../../requestChain/OperationSelection";
import { EnvironmentForCredentials } from "../EnvironmentForCredentials";
import { CollectionRequests } from "./CollectionRequests";
import { WorkflowSummary } from "./WorkflowSummary";
import { SOURCE_LABELS, stepLabel, type SourceKind } from "./pathState";

/** The operations of a specification, in specification order. */
export const operationKeysOf = (quickTest: QuickPerformanceTestView): string[] => quickTest.specification.operations.map(toOperationKey);

/**
 * Step 2 of the Performance path, for a specification (specs/047-unified-performance-tab FR-008,
 * FR-009): choose the operations the plan is seeded from, and optionally the environment its literal
 * credentials move into. Next, in the path's footer, creates the plan from the chosen operations.
 * For a plan that already exists it is a read-only summary until the plan's own Change operations
 * panel applies a new selection (FR-015).
 */
export function OperationsStep({
  source,
  quickTest,
  selection,
  onSelectionChange,
  environmentId,
  onEnvironmentChange,
  existingPlan,
  creating,
  error,
  workflow = { kind: "idle" },
  collectionId = null,
  onCollectionChange = () => undefined,
}: Readonly<{
  source: SourceKind;
  quickTest: QuickPerformanceTestView | null;
  selection: readonly string[];
  onSelectionChange: (keys: readonly string[]) => void;
  environmentId: string;
  onEnvironmentChange: (environmentId: string) => void;
  /** Set when a plan exists: what it was seeded from and how many items it was seeded with. */
  existingPlan?: { sourceLabel: string; selectedCount: number; selectable: boolean; unavailableReason?: string };
  creating: boolean;
  error: string | null;
  /** The guided workflow, read while the source is the guided workflow. */
  workflow?: GuidedWorkflowSummary;
  /** The imported collection chosen, when the source is a collection. */
  collectionId?: string | null;
  onCollectionChange?: (collectionId: string | null, requestIds: readonly string[], name?: string) => void;
}>) {
  if (existingPlan && !(existingPlan.selectable && quickTest)) {
    const why = existingPlan.unavailableReason ?? (source === "specification" ? "Changing the selection is offered on the Plan step." : "A plan seeded from this source keeps the steps it was seeded with; add or remove steps on the Plan step.");
    return (
      <div className="space-y-2" data-testid="operations-step-readonly">
        <h3 className="text-base font-semibold">{stepLabel("operations", source)}</h3>
        <p className="text-sm text-muted">
          This plan was seeded from {existingPlan.sourceLabel} with {existingPlan.selectedCount} {existingPlan.selectedCount === 1 ? "item" : "items"}. {why}
        </p>
      </div>
    );
  }

  if (!existingPlan && (source === "workflow" || source === "collection")) {
    return (
      <div className="space-y-4" data-testid={source === "workflow" ? "operations-step-workflow" : "operations-step-collection"}>
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{source === "workflow" ? "Seed the guided workflow" : "Choose the requests to include"}</h3>
          {source === "collection" && (
            <p className="max-w-3xl text-sm text-muted">The plan gets one chain for each top-level folder, in the collection's run order, with the requests you choose. You then edit every request yourself. Nothing is sent to any system until you trigger a run.</p>
          )}
        </div>
        {source === "workflow" ? <WorkflowSummary summary={workflow} /> : <CollectionRequests collectionId={collectionId} selection={selection} onCollectionChange={onCollectionChange} onSelectionChange={onSelectionChange} />}
        <div className="max-w-xl">
          <EnvironmentForCredentials environmentId={environmentId} onChange={onEnvironmentChange} />
        </div>
        {creating && (
          <p role="status" className="text-sm text-muted">
            Creating the plan...
          </p>
        )}
        {error && <ErrorState message={error} testId="plan-create-error" />}
      </div>
    );
  }

  if (source !== "specification" || !quickTest) {
    return (
      <div className="space-y-2" data-testid="operations-step-unavailable">
        <h3 className="text-base font-semibold">{stepLabel("operations", source)}</h3>
        <p className="text-sm text-muted">{source === "specification" ? "Upload a specification on the Source step first." : `Starting from ${SOURCE_LABELS[source].toLowerCase()} is not available here yet.`}</p>
      </div>
    );
  }

  const checked = new Set(selection);
  return (
    <div className="space-y-4" data-testid="operations-step">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{existingPlan ? "Change the operations in this plan" : "Choose the operations to include"}</h3>
        <p className="max-w-3xl text-sm text-muted">
          {existingPlan
            ? "Next applies the new selection to the plan: deselected operations are removed, newly selected ones are added at the end, and your edits to the steps that stay are kept. If a removal would discard steps you edited, you are asked first."
            : "The plan gets one step for each chosen operation, from its generated positive scenario, with credential requests run once before the load. You then edit every request yourself. Nothing is sent to any system until you trigger a run."}
        </p>
      </div>
      <OperationSelection operations={quickTest.specification.operations} checkedKeys={checked} onChange={(next) => onSelectionChange(operationKeysOf(quickTest).filter((key) => next.has(key)))} />
      {!existingPlan && (
        <div className="max-w-xl">
          <EnvironmentForCredentials environmentId={environmentId} onChange={onEnvironmentChange} />
        </div>
      )}
      {creating && (
        <p role="status" className="text-sm text-muted">
          {existingPlan ? "Applying the selection..." : "Creating the plan..."}
        </p>
      )}
      {error && <ErrorState message={error} testId="plan-create-error" />}
    </div>
  );
}
