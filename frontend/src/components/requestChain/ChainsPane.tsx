import { useMemo, useRef, useState } from "react";
import type { ChainStep, StepCheck } from "@apipilot/shared-domain";
import { ConfirmDialog } from "../ConfirmDialog";
import { PromptDialog } from "../PromptDialog";
import * as edit from "./chainEditing";
import { ChainTree } from "./ChainTree";
import { Disclosure } from "./Disclosure";
import { PlanIssues } from "./PlanIssues";
import { SeedingReportView } from "./SeedingReportView";
import { StepActions } from "./StepActions";
import { StepEditor } from "./StepEditor";
import { referenceSuggestions, type ChainPlanSession } from "./useChainPlanSession";

type Dialog = { kind: "new-chain" } | { kind: "rename-chain"; chainId: string } | { kind: "delete-chain"; chainId: string } | null;

function seedingSummary(itemCount: number): string {
  if (itemCount === 0) return "Everything was carried over.";
  return `${itemCount} ${itemCount === 1 ? "item" : "items"} not carried over. The report never blocks the script.`;
}

/**
 * The chains of a plan: the tree and the step editor in one workbench, then the plan check and the
 * seeding report (specs/037-request-chain-performance US1, US2). Shown as the editor's Chains tab and as
 * the Performance path's Plan step.
 */
export function ChainsPane({ session }: Readonly<{ session: ChainPlanSession }>) {
  const { plan, analysis, environment, selectedStepId, setSelectedStepId, change, save, busy } = session;
  const [dialog, setDialog] = useState<Dialog>(null);
  // Plan check opens itself while something blocks the script; the engineer's own choice wins once made.
  const [planCheckChoice, setPlanCheckChoice] = useState<boolean | null>(null);
  const [seedingOpen, setSeedingOpen] = useState(false);
  const [revealCount, setRevealCount] = useState(0);
  const workbenchRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(() => referenceSuggestions(plan, selectedStepId, environment), [plan, selectedStepId, environment]);
  const selected = plan.chains.flatMap((chain) => chain.steps).find((step) => step.id === selectedStepId) ?? null;
  const stepsWithIssues = new Set(analysis.blockers.flatMap((blocker) => ("stepId" in blocker ? [blocker.stepId] : [])));
  const updateStep = (step: ChainStep) => change(edit.updateStep(plan, step.id, () => step));
  const planCheckOpen = planCheckChoice ?? analysis.blockers.length > 0;

  // Plan check and the seeding report sit below the workbench, so jumping to a step brings it back into view.
  function goToStep(stepId: string) {
    setSelectedStepId(stepId);
    setRevealCount((count) => count + 1);
    if (typeof workbenchRef.current?.scrollIntoView === "function") workbenchRef.current.scrollIntoView({ block: "start" });
  }

  function addCheck(kind: StepCheck["kind"]) {
    if (!selected) return;
    const { plan: next, id } = edit.nextItemId(plan, "k");
    const check: StepCheck =
      kind === "time-at-most" ? { id, kind, maxMs: 500 } : kind === "body-contains" ? { id, kind, text: "" } : kind === "field-exists" ? { id, kind, path: "" } : { id, kind, path: "", expected: { type: "text", value: "" } };
    change(edit.updateStep(next, selected.id, (step) => ({ ...step, checks: [...step.checks, check] })));
  }

  function addExtractor() {
    if (!selected) return;
    const { plan: next, id } = edit.nextItemId(plan, "x");
    change(edit.updateStep(next, selected.id, (step) => ({ ...step, extractors: [...step.extractors, { id, name: "", source: { kind: "body", path: "" } }] })));
  }

  return (
    <div className="space-y-4">
      {/* A workbench: on a wide screen the tree and the editor share one viewport-high frame and
          scroll on their own, so the page does not grow with the plan and a step picked in the tree
          is already beside its editor. The height is viewport-relative, which no fixed utility
          expresses. Below lg the two stack and the page scrolls as before. */}
      <div ref={workbenchRef} className="grid scroll-mt-2 grid-cols-1 gap-4 lg:h-[max(32rem,calc(100dvh-5rem))] lg:grid-cols-[minmax(20rem,2fr)_minmax(0,3fr)]" data-testid="chain-workbench">
        <ChainTree
          plan={plan}
          selectedStepId={selectedStepId}
          stepsWithIssues={stepsWithIssues}
          busy={busy}
          revealCount={revealCount}
          actions={{
            onSelect: setSelectedStepId,
            onAddChain: () => setDialog({ kind: "new-chain" }),
            onRenameChain: (chainId) => setDialog({ kind: "rename-chain", chainId }),
            onMoveChain: (chainId, offset) => change(edit.moveChain(plan, chainId, offset), true),
            onDuplicateChain: (chainId) => change(edit.duplicateChain(plan, chainId), true),
            onDeleteChain: (chainId) => setDialog({ kind: "delete-chain", chainId }),
            onAddStep: (chainId) => {
              const added = edit.addStep(plan, chainId);
              setSelectedStepId(added.stepId);
              change(added.plan, true);
            },
          }}
        />
        {selected ? (
          <StepEditor
            key={selected.id}
            step={selected}
            suggestions={suggestions}
            onChange={updateStep}
            onCommit={() => void save()}
            onAddExtractor={addExtractor}
            onAddCheck={addCheck}
            actions={
              <StepActions
                plan={plan}
                step={selected}
                busy={busy}
                actions={{
                  onMoveStep: (stepId, offset) => change(edit.moveStep(plan, stepId, offset), true),
                  onMoveStepToChain: (stepId, chainId) => change(edit.moveStepToChain(plan, stepId, chainId), true),
                  onDuplicateStep: (stepId) => {
                    const copied = edit.duplicateStep(plan, stepId);
                    setSelectedStepId(copied.stepId);
                    change(copied.plan, true);
                  },
                  onDeleteStep: (stepId) => {
                    setSelectedStepId(null);
                    change(edit.deleteStep(plan, stepId), true);
                  },
                }}
              />
            }
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">Select a step, or add one to a chain.</p>
        )}
      </div>
      <Disclosure
        title="Plan check"
        open={planCheckOpen}
        onToggle={() => setPlanCheckChoice(!planCheckOpen)}
        summary={
          analysis.blockers.length === 0
            ? "Ready to generate. Nothing blocks the script."
            : `${analysis.blockers.length} ${analysis.blockers.length === 1 ? "problem blocks" : "problems block"} the script.`
        }
      >
        <PlanIssues plan={plan} analysis={analysis} environmentChosen={environment !== null} onGoToStep={goToStep} />
      </Disclosure>
      {/* Seeding always produces a report (AP-037 FR-025); with nothing to list, one line says so instead of an empty panel (AP-040). */}
      {plan.seedingReport && plan.seedingReport.items.length === 0 && (
        <p className="px-1 text-sm text-muted" data-testid="seeding-report-empty">
          Seeding report: {seedingSummary(0).toLowerCase()}
        </p>
      )}
      {plan.seedingReport && plan.seedingReport.items.length > 0 && (
        <Disclosure title="Seeding report" open={seedingOpen} onToggle={() => setSeedingOpen(!seedingOpen)} summary={seedingSummary(plan.seedingReport.items.length)}>
          <SeedingReportView report={plan.seedingReport} onGoToStep={goToStep} />
        </Disclosure>
      )}
      {(dialog?.kind === "new-chain" || dialog?.kind === "rename-chain") && (
        <PromptDialog
          title={dialog.kind === "new-chain" ? "New chain" : "Rename chain"}
          label="Chain name"
          initialValue={dialog.kind === "rename-chain" ? (plan.chains.find((chain) => chain.id === dialog.chainId)?.name ?? "") : `Chain ${plan.chains.length + 1}`}
          confirmLabel={dialog.kind === "new-chain" ? "Add chain" : "Rename"}
          onConfirm={(name) => {
            setDialog(null);
            if (dialog.kind === "new-chain") change(edit.addChain(plan, name), true);
            else change(edit.renameChain(plan, dialog.chainId, name), true);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete-chain" && (
        <ConfirmDialog
          message={`Delete the chain "${plan.chains.find((chain) => chain.id === dialog.chainId)?.name ?? ""}" and its steps?`}
          affectedCount={plan.chains.find((chain) => chain.id === dialog.chainId)?.steps.length ?? 0}
          confirmLabel="Delete chain"
          onConfirm={() => {
            setDialog(null);
            change(edit.deleteChain(plan, dialog.chainId), true);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
