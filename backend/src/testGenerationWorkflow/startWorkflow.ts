import { buildApiModel } from "../openapi/buildApiModel";
import { parseYaml } from "../openapi/parseYaml";
import { validateSpec } from "../openapi/validateSpec";
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
 * Starts a new workflow from an uploaded specification (upload + analysis stages, atomically —
 * research.md D4), reusing AP-002's own parse/validate/build pipeline unmodified. Refuses with
 * `WorkflowInProgressError` unless `discardExisting` is set (FR-010).
 *
 * `InvalidYamlError`/`UnsupportedVersionError` propagate unchanged for the centralized error
 * handler in app.ts to map, exactly as `POST /api/specifications` already does.
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
  const content = fileBuffer.toString("utf-8");
  const rawDoc = parseYaml(content);
  const { document, issues } = await validateSpec(rawDoc);
  const apiModel = buildApiModel(document, issues);
  const workflow = startWorkflowInStore({ specificationFilename: filename, apiModel });
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
