import { toOperationKey, type ApiModel, type TestGenerationWorkflow } from "@apipilot/shared-domain";
import { UnknownOperationKeyError } from "./errors";

/**
 * Validates an apiReview selection against `apiModel` and returns it deduplicated and in
 * `apiModel.operations` order, so the stored selection — and therefore every downstream run —
 * is independent of the order the client happened to send keys in (determinism).
 *
 * Returns `undefined` for an absent or empty selection: choosing nothing means every operation
 * is in scope (specs/009 Clarifications 2026-09-23), which is represented by the field's absence
 * rather than by an empty array that could be misread as "test nothing".
 */
export function normalizeOperationSelection(
  apiModel: ApiModel,
  selectedOperationKeys: readonly string[] | undefined,
): string[] | undefined {
  if (!selectedOperationKeys || selectedOperationKeys.length === 0) return undefined;
  const knownKeys = apiModel.operations.map(toOperationKey);
  const known = new Set(knownKeys);
  const unknown = selectedOperationKeys.find((key) => !known.has(key));
  if (unknown !== undefined) {
    throw new UnknownOperationKeyError(unknown);
  }
  const requested = new Set(selectedOperationKeys);
  return knownKeys.filter((key) => requested.has(key));
}

/**
 * The workflow's `apiModel` narrowed to the operations chosen at apiReview, or the full model
 * when no subset was chosen. Mirrors `dependencyAnalysisStage`'s `scopeToApprovedOperations`:
 * only `operations` is narrowed, and each operation keeps its own resolved request/response
 * schemas, so the schemas reaching test design and the AI provider are exactly those the
 * selected operations reference. `summary` still describes the uploaded document as analyzed.
 */
export function scopeApiModelToSelection(workflow: TestGenerationWorkflow): ApiModel {
  const apiModel = workflow.apiModel!;
  if (!workflow.selectedOperationKeys) return apiModel;
  const selected = new Set(workflow.selectedOperationKeys);
  return {
    ...apiModel,
    operations: apiModel.operations.filter((operation) => selected.has(toOperationKey(operation))),
  };
}
