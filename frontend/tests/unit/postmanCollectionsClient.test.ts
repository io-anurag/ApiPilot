import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportResult } from "@apipilot/shared-domain";
import {
  ARTIFACT_FILENAMES,
  artifactFilenames,
  artifactFiles,
  requestPostmanExport,
} from "../../src/services/postmanCollectionsClient";

function exportResult(): ExportResult {
  return {
    collection: {
      info: {
        name: "ApiPilot API tests",
        _postman_id: "id",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [],
      item: [],
    },
    environment: {
      name: "ApiPilot API tests environment",
      _postman_variable_scope: "environment",
      values: [],
    },
    readme: "# ApiPilot API tests\n",
    validation: { valid: true, problems: [] },
    limitations: [],
    summary: { requestCount: 0, folderCount: 0, byProvenance: { RULE: 0, AI: 0 } },
  };
}

describe("artifactFilenames", () => {
  it("falls back to the generic names when the specification has no usable title", () => {
    expect(artifactFilenames(undefined)).toEqual(ARTIFACT_FILENAMES);
    expect(artifactFilenames("   ")).toEqual(ARTIFACT_FILENAMES);
    expect(artifactFilenames("***")).toEqual(ARTIFACT_FILENAMES);
  });

  it("derives a filesystem-safe slug from the specification title (FR-022)", () => {
    expect(artifactFilenames("Orders API")).toEqual({
      collection: "orders-api.postman_collection.json",
      environment: "orders-api.postman_environment.json",
      readme: "orders-api.README.md",
    });
  });

  it("collapses punctuation and trims stray separators", () => {
    expect(artifactFilenames(" Pet Store: v2.1! ")).toEqual({
      collection: "pet-store-v2-1.postman_collection.json",
      environment: "pet-store-v2-1.postman_environment.json",
      readme: "pet-store-v2-1.README.md",
    });
  });
});

describe("artifactFiles", () => {
  it("names the downloaded files after the specification title when supplied", () => {
    const files = artifactFiles(exportResult(), "Orders API");
    expect(files.map((file) => file.filename)).toEqual([
      "orders-api.postman_collection.json",
      "orders-api.postman_environment.json",
      "orders-api.README.md",
    ]);
  });

  it("uses the generic names when no title is supplied", () => {
    const files = artifactFiles(exportResult());
    expect(files.map((file) => file.filename)).toEqual([
      ARTIFACT_FILENAMES.collection,
      ARTIFACT_FILENAMES.environment,
      ARTIFACT_FILENAMES.readme,
    ]);
  });
});

describe("requestPostmanExport logging (FR-010)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs a structured entry when a network error is caught", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await requestPostmanExport(
      { operations: [], securitySchemes: {}, summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] } },
      { scenarios: [] },
    );

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "postmanCollectionsClient",
      operation: "requestPostmanExport",
      errorCategory: "network_error",
    });
  });

  it("logs a structured entry when the backend returns a non-2xx response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "empty_approved_test_model", message: "No scenarios approved" }),
      } as Response),
    );

    const result = await requestPostmanExport(
      { operations: [], securitySchemes: {}, summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] } },
      { scenarios: [] },
    );

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "postmanCollectionsClient",
      operation: "requestPostmanExport",
      errorCategory: "empty_approved_test_model",
      statusCode: 400,
    });
  });
});
