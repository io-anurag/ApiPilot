import type { ApiModel } from "@apipilot/shared-domain";
import { buildApiModel } from "../../openapi/buildApiModel";
import { parseYaml } from "../../openapi/parseYaml";
import { validateSpec } from "../../openapi/validateSpec";

/**
 * The OpenAPI adapter of the input layer. It wraps the existing pipeline and changes none of it:
 * `parseYaml`, `validateSpec` and `buildApiModel` run exactly as they did when the upload routes
 * called them directly, so the YAML experience (errors, issues, models) is unchanged (FR-006) and
 * a JSON document gets the same validation, normalization and model building as its YAML twin
 * (FR-007, FR-008).
 */

/** OpenAPI as YAML text: the unchanged pipeline. */
export async function loadOpenApiFromYaml(text: string): Promise<ApiModel> {
  const rawDoc = parseYaml(text);
  const { document, issues } = await validateSpec(rawDoc);
  return buildApiModel(document, issues);
}

/**
 * OpenAPI as an already-parsed JSON document. A document with an unsupported version (including
 * Swagger 2.0) reaches `validateSpec` and receives the identical `UnsupportedVersionError`.
 */
export async function loadOpenApiFromJson(document: Record<string, unknown>): Promise<ApiModel> {
  const { document: validated, issues } = await validateSpec(document);
  return buildApiModel(validated, issues);
}
