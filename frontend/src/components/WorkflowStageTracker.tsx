import { WORKFLOW_STAGE_ORDER, type TestGenerationWorkflow, type WorkflowStageId } from "@apipilot/shared-domain";

const STAGE_LABELS: Record<WorkflowStageId, string> = {
  upload: "Upload",
  analysis: "Analysis",
  apiReview: "API Review",
  deterministicGeneration: "Deterministic Generation",
  aiEnhancement: "AI Enhancement",
  scenarioReview: "Scenario Review",
  dependencyAnalysis: "Dependency Analysis",
  workflowReview: "Workflow Review",
  postmanGeneration: "Postman Generation",
};

const STATUS_LABELS = {
  "not-yet-reached": "Not yet reached",
  active: "Active",
  complete: "Complete",
  stale: "Needs to be redone",
  skipped: "Skipped",
} as const;

/**
 * Shows every stage's status (User Story 2, FR-004) and any workflow-level condition worth
 * surfacing outside the active stage's own screen — analysis issues and AI-unavailability.
 */
/** The only stages a QA engineer can revisit to revise a decision (research.md D3). */
const REVISABLE_STAGES = new Set<WorkflowStageId>(["scenarioReview", "workflowReview"]);

export function WorkflowStageTracker({
  workflow,
  onViewStage,
}: {
  workflow: TestGenerationWorkflow;
  onViewStage?: (stageId: WorkflowStageId) => void;
}) {
  const issues = workflow.apiModel?.summary.issues ?? [];
  const aiSkip = workflow.stages.aiEnhancement;
  const dependencyAiIssue = workflow.dependencyAnalysis?.aiErrorCategory;

  return (
    <nav aria-label="Workflow progress" data-testid="workflow-stage-tracker">
      <ol>
        {WORKFLOW_STAGE_ORDER.map((stageId) => {
          const stage = workflow.stages[stageId];
          const isActive = workflow.activeStageId === stageId;
          const isRevisitable =
            onViewStage && REVISABLE_STAGES.has(stageId) && (stage.status === "complete" || stage.status === "stale");
          return (
            <li key={stageId} aria-current={isActive ? "step" : undefined}>
              <span>{STAGE_LABELS[stageId]}</span>{" "}
              {isRevisitable ? (
                <button type="button" data-testid={`stage-status-${stageId}`} onClick={() => onViewStage!(stageId)}>
                  {STATUS_LABELS[stage.status]} — revisit
                </button>
              ) : (
                <span data-testid={`stage-status-${stageId}`}>{STATUS_LABELS[stage.status]}</span>
              )}
            </li>
          );
        })}
      </ol>
      {issues.length > 0 && (
        <div role="status" data-testid="workflow-analysis-issues">
          <p>{issues.length} specification analysis issue(s) were found:</p>
          <ul>
            {issues.map((issue) => (
              <li key={`${issue.kind}-${issue.location}`}>
                <strong>{issue.kind}</strong> at {issue.location}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {aiSkip.status === "skipped" && (
        <p role="status" data-testid="workflow-ai-unavailable">
          AI enhancement was skipped ({aiSkip.aiErrorCategory}): {aiSkip.aiErrorMessage}
        </p>
      )}
      {dependencyAiIssue && (
        <p role="status" data-testid="workflow-dependency-ai-issue">
          AI-assisted dependency detection did not complete ({dependencyAiIssue}); deterministic
          relationships are still shown.
        </p>
      )}
    </nav>
  );
}
