import { parseYaml } from "../openapi/parseYaml";
import { InvalidYamlError } from "../openapi/errors";
import {
  AmbiguousInputError,
  InputLimitExceededError,
  InvalidJsonError,
  UnrecognizedInputError,
} from "./errors";
import { scanJsonDepth } from "./jsonSafe";
import { INPUT_LIMIT_VARIABLES, type InputLimits } from "./limits";

/** The four families a JSON document can belong to (research R3). */
export type JsonFamily = "openapi" | "har" | "api-definition" | "postman-collection";

export type Detection =
  /** Not JSON (or JSON-looking text that is valid YAML): processed by today's OpenAPI YAML pipeline, unchanged. */
  | { kind: "yaml" }
  | { kind: "json"; family: JsonFamily; document: Record<string, unknown> };

export const DEFINITION_FORMAT_ID = "apipilot.api-definition";

const FAMILY_NAMES: Record<JsonFamily, string> = {
  openapi: "OpenAPI",
  har: "HAR capture",
  "api-definition": "ApiPilot API definition",
  "postman-collection": "Postman collection",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads only the position out of a JSON parse failure; the engine's own message can quote the content. */
function describeJsonFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const located = /line (\d+) column (\d+)/.exec(message);
  if (located) return `invalid JSON at line ${located[1]}, column ${located[2]}.`;
  const position = /position (\d+)/.exec(message);
  if (position) return `invalid JSON at position ${position[1]}.`;
  return "the content is not valid JSON.";
}

/** The discriminating marker of each family. One marker is enough; a document must match exactly one. */
export function matchedFamilies(document: Record<string, unknown>): JsonFamily[] {
  const matched: JsonFamily[] = [];
  if (typeof document.openapi === "string" || typeof document.swagger === "string") matched.push("openapi");
  const log = document.log;
  if (
    isPlainObject(log) &&
    ("entries" in log || "version" in log || "creator" in log || "pages" in log)
  ) {
    matched.push("har");
  }
  if (document.format === DEFINITION_FORMAT_ID) matched.push("api-definition");
  const info = document.info;
  if (
    isPlainObject(info) &&
    ((typeof info.schema === "string" && info.schema.includes("schema.getpostman.com/json/collection/")) ||
      ("_postman_id" in info && Array.isArray(document.item)))
  ) {
    matched.push("postman-collection");
  }
  return matched;
}

/**
 * Decides how an upload is processed from its content, never from its name (FR-001). Pure apart from
 * the YAML fallback check for JSON-looking text that is not JSON.
 *
 * - Non-JSON content (including empty content) is YAML and follows the unchanged OpenAPI pipeline, so
 *   every existing parse error, version error and issue is preserved (FR-006).
 * - A JSON object is classified by one discriminating marker per family; no marker, or more than one,
 *   is refused and never resolved by precedence (FR-003, FR-005).
 */
export function detectFormat(rawText: string, limits: InputLimits): Detection {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const first = text.trimStart().charAt(0);
  if (first !== "{" && first !== "[") return { kind: "yaml" };

  if (scanJsonDepth(text, limits.maxJsonDepth).exceeded) {
    throw new InputLimitExceededError(
      INPUT_LIMIT_VARIABLES.maxJsonDepth,
      limits.maxJsonDepth,
      "Reduce the nesting of the document or split it into smaller files.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (jsonError) {
    // A YAML flow mapping that is not valid JSON is still a YAML document (FR-006).
    try {
      parseYaml(text);
      return { kind: "yaml" };
    } catch (yamlError) {
      if (!(yamlError instanceof InvalidYamlError)) throw yamlError;
      throw new InvalidJsonError(describeJsonFailure(jsonError));
    }
  }

  if (!isPlainObject(parsed)) throw new UnrecognizedInputError();

  const matched = matchedFamilies(parsed);
  if (matched.length === 0) throw new UnrecognizedInputError();
  if (matched.length > 1) throw new AmbiguousInputError(matched.map((family) => FAMILY_NAMES[family]));
  return { kind: "json", family: matched[0], document: parsed };
}
