import type { ApiModel } from "@apipilot/shared-domain";
import type { InputLimits } from "../limits";
import { buildHarModel } from "./buildHarModel";

/**
 * The HAR adapter of the input layer: validates the capture, builds the redacted `ApiModel` and the
 * import report, and throws `NoOperationsDerivedError` (carrying the counts by reason) when nothing
 * importable remains, so no workflow is created for it (specs/056 FR-021).
 */
export async function loadHar(document: Record<string, unknown>, limits: InputLimits): Promise<ApiModel> {
  return buildHarModel(document, limits);
}
