import type { ApiModel } from "@apipilot/shared-domain";
import { InvalidDefinitionError } from "../errors";
import { logInputEvent } from "../logging";
import { buildDefinitionModel } from "./buildDefinitionModel";
import { validateDefinition } from "./validateDefinition";

/**
 * The definition adapter of the input layer: validates the document strictly (every violation is
 * reported at once, nothing is imported when there is one), then maps it onto the `ApiModel`
 * (specs/056 FR-023, FR-024). It logs only the number of problems, never a message, a location or a
 * value from the document.
 */
export function loadDefinition(document: Record<string, unknown>): ApiModel {
  try {
    const model = buildDefinitionModel(validateDefinition(document));
    logInputEvent("definition_validated", { format: "api-definition", problemCount: 0, operations: model.operations.length });
    return model;
  } catch (error) {
    if (error instanceof InvalidDefinitionError) {
      logInputEvent("definition_validated", { format: "api-definition", problemCount: error.problems.length });
    }
    throw error;
  }
}
