import type { AIProvider, ApiModel, TestGenerationWorkflow, TestModel } from "@apipilot/shared-domain";
import { analyzeDependencies } from "../dependencies/analyzeDependencies";
import { createLogger } from "../logger";
import { StageNotActiveError } from "./errors";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";
import { maybeAutoCompleteWorkflowReview } from "./workflowReviewStage";

const logger = createLogger("testGenerationWorkflow.dependencyAnalysisStage");

function operationKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Narrows `apiModel` to the operations touched by at least one scenario in `approvedTestModel`.
 * A discovered workflow whose steps are not all backed by an approved scenario is discarded
 * anyway at Postman-generation time (`workflow-missing-scenario`,
 * postman/workflowRendering.ts:132-143), so analyzing every other operation in the specification
 * — deterministic matching and, worse, the AI-assisted pass — only spends time on relationships
 * that can never reach a generated collection. This narrows only this orchestration's input;
 * `analyzeDependencies` itself, and its standalone AP-008 endpoint (api/apiDependencies.ts), are
 * unchanged and still analyze whatever ApiModel they are given in full.
 */
function scopeToApprovedOperations(apiModel: ApiModel, approvedTestModel: TestModel): ApiModel {
  const approvedKeys = new Set(
    approvedTestModel.scenarios.map((scenario) =>
      operationKey(scenario.operationPath, scenario.operationMethod),
    ),
  );
  return {
    ...apiModel,
    operations: apiModel.operations.filter((operation) =>
      approvedKeys.has(operationKey(operation.path, operation.method)),
    ),
  };
}

/**
 * Runs the unmodified AP-008 `analyzeDependencies`, scoped to the operations touched by the
 * finalized `approvedTestModel` (specs/009-e2e-test-generation-workflow data-model.md, updated:
 * previously ran over the whole `apiModel` regardless of which scenarios were approved), and
 * advances to `workflowReview`, auto-completing it immediately when there is nothing to review
 * (D5). Has no separate HTTP trigger — called automatically once `scenarioReview` is finalized.
 */
export async function runDependencyAnalysis(provider?: AIProvider): Promise<TestGenerationWorkflow> {
  const startedAt = Date.now();
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow || workflow.stages.dependencyAnalysis.status !== "active") {
      throw new StageNotActiveError("dependencyAnalysis is not the active stage.");
    }
    const scopedApiModel = scopeToApprovedOperations(workflow.apiModel!, workflow.approvedTestModel!);
    const dependencyAnalysis = await analyzeDependencies(scopedApiModel, provider);
    patchWorkflow({ dependencyAnalysis });
    updateStage("dependencyAnalysis", "complete");
    advanceActiveStage("workflowReview");
    const result = maybeAutoCompleteWorkflowReview();
    logger.info("stage_complete", {
      stage: "dependencyAnalysis",
      workflowId: result.id,
      workflowCount: dependencyAnalysis.workflows.length,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error("stage_error", {
      stage: "dependencyAnalysis",
      workflowId: getCurrentWorkflow()?.id,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
