import {
  INPUT_FORMAT_LABELS,
  type ApiInputDescriptor,
  type ApiModel,
} from "@apipilot/shared-domain";
import { detectFormat } from "./detectFormat";
import { InputLimitExceededError, PostmanCollectionDetectedError } from "./errors";
import { loadInputLimits, type InputLimits } from "./limits";
import { logInputEvent } from "./logging";
import { loadDefinition } from "./definition/loadDefinition";
import { loadHar } from "./har/loadHar";
import { loadOpenApiFromJson, loadOpenApiFromYaml } from "./openapi/loadOpenApi";

/**
 * The one entry point of the format-independent input layer (specs/056, FR-027). Both upload routes
 * and the guided-workflow start call it, so every downstream stage consumes one `ApiModel` whatever
 * the file was. The format is decided from the bytes alone; the file name is carried only so the
 * workflow can show it.
 */
export interface ApiInputResult {
  apiModel: ApiModel;
  input: ApiInputDescriptor;
}

function describe(format: ApiInputDescriptor["format"], filename: string): ApiInputDescriptor {
  return { format, label: INPUT_FORMAT_LABELS[format], filename };
}

export async function loadApiInput(
  fileBuffer: Buffer,
  filename: string,
  limits: InputLimits = loadInputLimits(),
): Promise<ApiInputResult> {
  const startedAt = Date.now();
  try {
    const detection = detectFormat(fileBuffer.toString("utf-8"), limits);

    if (detection.kind === "yaml") {
      const apiModel = await loadOpenApiFromYaml(fileBuffer.toString("utf-8"));
      logInputEvent("input_detected", { format: "openapi-yaml", durationMs: Date.now() - startedAt });
      return { apiModel, input: describe("openapi-yaml", filename) };
    }

    switch (detection.family) {
      case "postman-collection":
        throw new PostmanCollectionDetectedError();
      case "openapi": {
        const apiModel = await loadOpenApiFromJson(detection.document);
        logInputEvent("input_detected", { format: "openapi-json", durationMs: Date.now() - startedAt });
        return { apiModel, input: describe("openapi-json", filename) };
      }
      case "har": {
        const apiModel = await loadHar(detection.document, limits);
        logInputEvent("input_detected", { format: "har", durationMs: Date.now() - startedAt });
        return { apiModel, input: describe("har", filename) };
      }
      case "api-definition": {
        const apiModel = loadDefinition(detection.document);
        logInputEvent("input_detected", { format: "api-definition", durationMs: Date.now() - startedAt });
        return { apiModel, input: describe("api-definition", filename) };
      }
    }
  } catch (error) {
    logInputEvent("input_rejected", {
      errorCategory: error instanceof Error ? error.name : "UnknownError",
      ...(error instanceof InputLimitExceededError ? { limit: error.limit } : {}),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
