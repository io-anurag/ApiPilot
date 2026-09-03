import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { nestedRequiredApiModel } from "../fixtures/testDesign/nestedRequiredApiModel";
import { MAX_UPLOAD_BYTES } from "../../src/uploadMiddleware";

/**
 * A real ApiModel derived from an upload near the 10MB upload limit (FR-015) is
 * expected to still round-trip through the JSON-body endpoints below it (test-model
 * generation, enhancement, review, Postman export). These guard against regressing to
 * body-parser's much smaller 100kb default, which previously surfaced as a fabricated
 * 500 instead of the request's real, client-side cause.
 */
function apiModelOfSize(minBytes: number): ApiModel {
  const template = nestedRequiredApiModel.operations[0];
  const bytesPerOperation = JSON.stringify(template).length + 20; // + path-suffix overhead
  const count = Math.ceil(minBytes / bytesPerOperation);
  const operations: ApiModel["operations"] = Array.from({ length: count }, (_, i) => ({
    ...template,
    path: `/widgets/{widgetId}/${i}`,
  }));
  return {
    operations,
    securitySchemes: {},
    summary: { operationCount: operations.length, schemaCount: 0, securitySchemeCount: 0, issues: [] },
  };
}

describe("JSON body size limit", () => {
  it("accepts a test-model request whose ApiModel exceeds body-parser's 100kb default", async () => {
    const app = createApp();
    const apiModel = apiModelOfSize(150_000);
    expect(JSON.stringify({ apiModel }).length).toBeGreaterThan(100_000);

    const response = await request(app).post("/api/test-models").send({ apiModel });

    expect(response.status).toBe(200);
    expect(response.body.testModel.scenarios.length).toBeGreaterThan(0);
  });

  it("returns 413 payload_too_large, not a generic 500, once the body exceeds the upload limit", async () => {
    const app = createApp();
    const apiModel = apiModelOfSize(MAX_UPLOAD_BYTES + 1_000_000);

    const response = await request(app).post("/api/test-models").send({ apiModel });

    expect(response.status).toBe(413);
    expect(response.body.error).toBe("payload_too_large");
  });
});
