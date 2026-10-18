import { loadApiInput } from "../apiInput";
import { createLogger } from "../logger";
import { AiEnhancementRunningError, WorkflowInProgressError } from "./errors";
import {
  clearCurrentWorkflow,
  getCurrentWorkflow,
  startWorkflow as startWorkflowInStore,
} from "./workflowStore";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";

const logger = createLogger("testGenerationWorkflow.startWorkflow");

/**
 * Starts a new workflow from an uploaded file (upload + analysis stages, atomically — research.md
 * D4) through the format-independent input layer (specs/056), which runs AP-002's own
 * parse/validate/build pipeline unmodified for OpenAPI. Refuses with `WorkflowInProgressError`
 * unless `discardExisting` is set (FR-010).
 *
 * Every input error (`InvalidYamlError`, `UnsupportedVersionError`, the specs/056 typed errors)
 * propagates unchanged for the centralized error handler in app.ts to map, exactly as
 * `POST /api/specifications` does. The session's existing workflow is replaced only after the
 * file has been analyzed successfully, so a failed upload leaves it untouched.
 */
export async function startWorkflowFromUpload(
  fileBuffer: Buffer,
  filename: string,
  discardExisting: boolean,
): Promise<TestGenerationWorkflow> {
  const existing = getCurrentWorkflow();
  if (existing && !discardExisting) {
    throw new WorkflowInProgressError();
  }
  if (existing) {
    logger.info("workflow_discarded", { workflowId: existing.id });
  }
  const { apiModel, input } = await loadApiInput(fileBuffer, filename);
  const workflow = startWorkflowInStore({ specificationFilename: filename, apiModel, input });
  logger.info("workflow_started", {
    workflowId: workflow.id,
    operationCount: apiModel.summary.operationCount,
  });
  return workflow;
}

/**
 * Discards the calling session's in-progress workflow on its own, once the user has confirmed it
 * (FR-010), so the confirmation takes effect immediately rather than only when a replacement
 * specification is uploaded. Idempotent: returns `false` when there was nothing to discard.
 * Refuses with `AiEnhancementRunningError` while an AI enhancement run is in flight
 * (`progress` present, the same signal FR-008 uses), since that run still writes into the workflow.
 */
export function discardCurrentWorkflow(): boolean {
  const existing = getCurrentWorkflow();
  if (!existing) return false;
  if (existing.stages.aiEnhancement.progress) {
    throw new AiEnhancementRunningError();
  }
  clearCurrentWorkflow();
  logger.info("workflow_discarded", { workflowId: existing.id });
  return true;
}
