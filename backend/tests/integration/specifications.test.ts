import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";

const fixturesDir = path.join(__dirname, "..", "fixtures", "openapi");
const fixture = (name: string) => readFileSync(path.join(fixturesDir, name));

describe("POST /api/specifications", () => {
  it("returns 200 with an apiModel for a valid OpenAPI 3.x document", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/specifications")
      .attach("file", fixture("valid.yaml"), "valid.yaml");

    expect(response.status).toBe(200);
    expect(response.body.apiModel.summary.operationCount).toBe(3);
    expect(response.body.apiModel.summary.issues).toEqual([]);
    expect(response.body.apiModel.operations).toHaveLength(3);
    expect(Object.keys(response.body.apiModel.securitySchemes)).toContain("ApiKeyAuth");
  });

  it("returns 400 invalid_yaml for a malformed YAML file", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/specifications")
      .attach("file", fixture("invalid-yaml.txt"), "invalid.yaml");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_yaml");
  });

  it("returns 400 unsupported_version for a Swagger 2.0 document", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/specifications")
      .attach("file", fixture("unsupported-version.yaml"), "unsupported-version.yaml");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unsupported_version");
  });

  it("returns 200 with flagged issues (not a rejection) for unresolved/circular/external refs", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/specifications")
      .attach("file", fixture("circular-ref.yaml"), "circular-ref.yaml");

    expect(response.status).toBe(200);
    expect(
      response.body.apiModel.summary.issues.some((issue: { kind: string }) => issue.kind === "circular-ref"),
    ).toBe(true);
  });

  it("responds 405 for non-POST methods", async () => {
    const app = createApp();

    const response = await request(app).get("/api/specifications");

    expect(response.status).toBe(405);
  });
});
