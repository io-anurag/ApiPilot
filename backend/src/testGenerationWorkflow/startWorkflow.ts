import { buildApiModel } from "../openapi/buildApiModel";
import { parseYaml } from "../openapi/parseYaml";
import { validateSpec } from "../openapi/validateSpec";
import { createLogger } from "../logger";
import { WorkflowInProgressError } from "./errors";
import { getCurrentWorkflow, startWorkflow as startWorkflowInStore } from "./workflowStore";
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
