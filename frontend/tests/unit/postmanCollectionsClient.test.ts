import { describe, expect, it } from "vitest";
import type { ExportResult } from "@apipilot/shared-domain";
import { ARTIFACT_FILENAMES, artifactFilenames, artifactFiles } from "../../src/services/postmanCollectionsClient";

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
