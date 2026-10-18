import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import type { ApiInputDescriptor, ApiModel, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { MAX_UPLOAD_BYTES } from "../../src/uploadMiddleware";

const openapiDir = path.join(__dirname, "..", "fixtures", "openapi");
const jsonDir = path.join(__dirname, "..", "fixtures", "apiInput", "json");
const openapi = (name: string) => readFileSync(path.join(openapiDir, name));
const jsonFixture = (name: string) => readFileSync(path.join(jsonDir, name));
const validJson = () => Buffer.from(JSON.stringify(yaml.load(openapi("valid.yaml").toString("utf-8"))));

const SPECIFICATIONS = "/api/specifications";
const WORKFLOW = "/api/test-generation-workflow";

type Upload = (app: ReturnType<typeof createApp>, file: Buffer, filename: string) => request.Test;
type JsonBody = Record<string, unknown>;

const routes: { name: string; upload: Upload; model: (body: JsonBody) => ApiModel; input: (body: JsonBody) => ApiInputDescriptor }[] = [
  {
    name: `POST ${SPECIFICATIONS}`,
    upload: (app, file, filename) => request(app).post(SPECIFICATIONS).attach("file", file, filename),
    model: (body) => body.apiModel as ApiModel,
    input: (body) => body.input as ApiInputDescriptor,
  },
  {
    name: `POST ${WORKFLOW}`,
    upload: (app, file, filename) => request(app).post(WORKFLOW).attach("file", file, filename),
    model: (body) => (body.workflow as TestGenerationWorkflow).apiModel as ApiModel,
    input: (body) => (body.workflow as TestGenerationWorkflow).input as ApiInputDescriptor,
  },
];

describe.each(routes)("$name: format recognition (US1)", ({ upload, model, input }) => {
  it("reports OpenAPI (YAML) and leaves the YAML result unchanged", async () => {
    const response = await upload(createApp(), openapi("valid.yaml"), "valid.yaml");
    expect(response.status).toBe(200);
    expect(input(response.body)).toEqual({ format: "openapi-yaml", label: "OpenAPI (YAML)", filename: "valid.yaml" });
    expect(model(response.body).summary.operationCount).toBe(3);
    expect(model(response.body).summary.issues).toEqual([]);
  });

  it("reports OpenAPI (JSON) with the same operations and summary as the YAML twin", async () => {
    const app = createApp();
    const fromYaml = await upload(app, openapi("valid.yaml"), "valid.yaml");
    const fromJson = await upload(app, validJson(), "valid.json");
    expect(fromJson.status).toBe(200);
    expect(input(fromJson.body)).toEqual({ format: "openapi-json", label: "OpenAPI (JSON)", filename: "valid.json" });
    expect(model(fromJson.body)).toEqual(model(fromYaml.body));
  });

  it("judges by content, not extension: YAML named .json and JSON named .yaml both work", async () => {
    const app = createApp();
    const yamlAsJson = await upload(app, openapi("valid.yaml"), "spec.json");
    expect(input(yamlAsJson.body).format).toBe("openapi-yaml");
    const jsonAsYaml = await upload(app, validJson(), "spec.yaml");
    expect(input(jsonAsYaml.body).format).toBe("openapi-json");
  });

  it("redirects a Postman collection without importing anything", async () => {
    const response = await upload(createApp(), jsonFixture("postman-collection.json"), "collection.json");
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "postman_collection_detected", redirectTo: "import-run-collection" });
    expect(response.body.message).toContain("Import & Run Collection");
    expect(response.body.workflow).toBeUndefined();
    expect(response.body.apiModel).toBeUndefined();
  });

  it("rejects JSON with no marker, naming the supported formats and not echoing the document", async () => {
    const response = await upload(createApp(), jsonFixture("arbitrary.json"), "thing.json");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unrecognized_input_format");
    expect(response.body.message).toContain("Supported inputs");
    expect(response.body.message).not.toContain("world");
  });

  it("rejects a document that carries markers of two families", async () => {
    const response = await upload(createApp(), jsonFixture("ambiguous.json"), "both.json");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("ambiguous_input_format");
    expect(response.body.message).toContain("OpenAPI");
    expect(response.body.message).toContain("HAR capture");
  });

  it("gives Swagger 2.0 JSON the same unsupported_version outcome as its YAML equivalent", async () => {
    const app = createApp();
    const asJson = await upload(app, jsonFixture("swagger2.json"), "old.json");
    const asYaml = await upload(app, openapi("unsupported-version.yaml"), "old.yaml");
    expect(asJson.status).toBe(400);
    expect(asJson.body.error).toBe("unsupported_version");
    expect(asYaml.body.error).toBe("unsupported_version");
  });

  it("reports truncated JSON as invalid_json by position, not by extension and without content", async () => {
    const truncated = Buffer.from('{"log": {"entries": [{"request": {"url": "SEEDED-SECRET-TRUNCATED"');
    const response = await upload(createApp(), truncated, "capture.har");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_json");
    expect(JSON.stringify(response.body)).not.toContain("SEEDED-SECRET");
    expect(response.body.message).not.toContain(".har");
  });

  it("keeps the existing outcomes for invalid YAML and for empty uploads", async () => {
    const app = createApp();
    const invalid = await upload(app, openapi("invalid-yaml.txt"), "invalid.yaml");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid_yaml");
    for (const empty of ["", "   \n\t", "﻿"]) {
      const response = await upload(app, Buffer.from(empty), "empty.yaml");
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "invalid_yaml",
        message: "The uploaded file could not be parsed as YAML: document is empty or not an object",
      });
    }
  });

  it("keeps the existing 413 for a file over the upload limit", async () => {
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, "a");
    const response = await upload(createApp(), huge, "huge.json");
    expect(response.status).toBe(413);
    expect(response.body.error).toBe("file_too_large");
  });

  it("refuses JSON nested past the limit and names INPUT_MAX_JSON_DEPTH", async () => {
    const response = await upload(createApp(), Buffer.from("[".repeat(400) + "]".repeat(400)), "deep.json");
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: "input_limit_exceeded", limit: "INPUT_MAX_JSON_DEPTH", maximum: 128 });
  });
});

describe(`POST ${SPECIFICATIONS}: request shape`, () => {
  it("still answers 400 invalid_yaml when no file is attached", async () => {
    const response = await request(createApp()).post(SPECIFICATIONS);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_yaml");
  });
});

describe(`POST ${WORKFLOW}: workflow behaviour is unchanged for every format`, () => {
  it("keeps the 409 workflow_in_progress confirmation for a JSON upload too", async () => {
    const agent = request.agent(createApp());
    expect((await agent.post(WORKFLOW).attach("file", openapi("valid.yaml"), "a.yaml")).status).toBe(200);
    const conflict = await agent.post(WORKFLOW).attach("file", validJson(), "b.json");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("workflow_in_progress");
  });

  it("leaves the session's workflow untouched when a replacement upload is rejected", async () => {
    const agent = request.agent(createApp());
    const first = await agent.post(WORKFLOW).attach("file", openapi("valid.yaml"), "a.yaml");
    const rejected = await agent
      .post(`${WORKFLOW}?discardExisting=true`)
      .attach("file", jsonFixture("postman-collection.json"), "collection.json");
    expect(rejected.status).toBe(400);
    const current = await agent.get(WORKFLOW);
    expect(current.status).toBe(200);
    expect(current.body.workflow.id).toBe(first.body.workflow.id);
    expect(current.body.workflow.input.format).toBe("openapi-yaml");
  });

  it("replaces the workflow, with the new format, when the replacement is accepted", async () => {
    const agent = request.agent(createApp());
    await agent.post(WORKFLOW).attach("file", openapi("valid.yaml"), "a.yaml");
    const replaced = await agent.post(`${WORKFLOW}?discardExisting=true`).attach("file", validJson(), "b.json");
    expect(replaced.status).toBe(200);
    expect(replaced.body.workflow.input.format).toBe("openapi-json");
  });
});

const harDir = path.join(__dirname, "..", "fixtures", "apiInput", "har");
const harFixture = (name: string) => readFileSync(path.join(harDir, name));

describe.each(routes)("$name: HAR capture (US2)", ({ upload, model, input }) => {
  it("imports a capture, reports the format and the import report, and exposes no raw credential", async () => {
    const response = await upload(createApp(), harFixture("realistic.har"), "capture.har");
    expect(response.status).toBe(200);
    expect(input(response.body)).toEqual({ format: "har", label: "HAR capture", filename: "capture.har" });
    const apiModel = model(response.body);
    expect(apiModel.importReport?.counts).toEqual({ total: 46, imported: 29, excluded: 12, malformed: 5, operations: 18 });
    expect(apiModel.summary.operationCount).toBe(18);
    expect(JSON.stringify(response.body)).not.toContain("tk_9f8e7d6c5b4a3f2e1d0c");
    expect(JSON.stringify(response.body)).not.toContain("synthetic-password-1");
  });

  it("judges a capture by its content, whatever the file is called", async () => {
    const response = await upload(createApp(), harFixture("realistic.har"), "capture.json");
    expect(input(response.body).format).toBe("har");
  });

  it("is deterministic: the same capture gives an identical model each time", async () => {
    const app = createApp();
    const first = await upload(app, harFixture("realistic.har"), "capture.har");
    const second = await upload(app, harFixture("realistic.har"), "capture.har");
    expect(JSON.stringify(model(second.body))).toBe(JSON.stringify(model(first.body)));
  });

  it("rejects a capture whose entries are missing or empty with an actionable message", async () => {
    const empty = await upload(createApp(), harFixture("invalid-no-entries.har"), "empty.har");
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("invalid_har");
    expect(empty.body.message).toContain("no entries");
    const notAList = await upload(createApp(), Buffer.from(JSON.stringify({ log: { version: "1.2", entries: {} } })), "bad.har");
    expect(notAList.status).toBe(400);
    expect(notAList.body.error).toBe("invalid_har");
    expect(notAList.body.message).toContain("log.entries");
  });

  it("reports a file with no log object as unrecognized and a truncated file as invalid JSON", async () => {
    const noLog = await upload(createApp(), harFixture("invalid-no-log.har"), "nolog.har");
    expect(noLog.body.error).toBe("unrecognized_input_format");
    const truncated = await upload(createApp(), harFixture("invalid-not-json.har"), "cut.har");
    expect(truncated.body.error).toBe("invalid_json");
  });

  it("creates no workflow and returns the counts by reason when nothing can be imported", async () => {
    const response = await upload(createApp(), harFixture("all-excluded.har"), "noise.har");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("no_operations_derived");
    expect(response.body.report.counts).toEqual({ total: 5, imported: 0, excluded: 4, malformed: 1, operations: 0 });
    expect(response.body.report.exclusions.map((group: { reason: string }) => group.reason)).toEqual(["analytics-telemetry", "static-asset", "html-document"]);
    expect(response.body.workflow).toBeUndefined();
  });
});

describe("HAR upload through the guided workflow", () => {
  it("starts a workflow the user can continue from, with the operations in the review stage", async () => {
    const agent = request.agent(createApp());
    const started = await agent.post(WORKFLOW).attach("file", harFixture("realistic.har"), "capture.har");
    expect(started.body.workflow.activeStageId).toBe("apiReview");
    expect(started.body.workflow.input.format).toBe("har");
    const kept = await agent.post(`${WORKFLOW}/api-review/continue`).send({ selectedOperationKeys: ["GET /v1/orders", "POST /v1/orders"] });
    expect(kept.status).toBe(200);
    expect(kept.body.workflow.selectedOperationKeys).toEqual(["GET /v1/orders", "POST /v1/orders"]);
  });

  it("leaves the existing workflow untouched when a replacement capture creates nothing", async () => {
    const agent = request.agent(createApp());
    const first = await agent.post(WORKFLOW).attach("file", openapi("valid.yaml"), "a.yaml");
    const rejected = await agent.post(`${WORKFLOW}?discardExisting=true`).attach("file", harFixture("all-excluded.har"), "noise.har");
    expect(rejected.status).toBe(400);
    expect((await agent.get(WORKFLOW)).body.workflow.id).toBe(first.body.workflow.id);
  });
});

const definitionDir = path.join(__dirname, "..", "fixtures", "apiInput", "definitions");
const definitionFixture = (name: string) => readFileSync(path.join(definitionDir, name));

describe.each(routes)("$name: API definition upload (US6)", ({ upload, model, input }) => {
  it("imports a valid definition and reports the format", async () => {
    const response = await upload(createApp(), definitionFixture("valid.json"), "orders.json");
    expect(response.status).toBe(200);
    expect(input(response.body)).toEqual({ format: "api-definition", label: "ApiPilot API definition", filename: "orders.json" });
    const apiModel = model(response.body);
    expect(apiModel.summary).toMatchObject({ operationCount: 2, securitySchemeCount: 1 });
    expect(apiModel.declaredBaseUrl).toBe("https://api.example.test");
    expect(apiModel.operations.every((operation) => operation.provenance?.origin === "declared")).toBe(true);
    expect(apiModel.dependencyHints).toHaveLength(1);
  });

  it("judges by content, not by file name", async () => {
    const response = await upload(createApp(), definitionFixture("valid.json"), "orders.yaml");
    expect(response.status).toBe(200);
    expect(input(response.body).format).toBe("api-definition");
  });

  it("answers invalid_definition with every problem and its location, and imports nothing", async () => {
    const response = await upload(createApp(), definitionFixture("invalid/many-problems.json"), "bad.json");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_definition");
    expect(response.body.message).toContain("6 problems found");
    expect(response.body.problems).toEqual([
      "/baseUrl: must be an absolute http or https URL without credentials, query or fragment",
      "/dependencyHints/0/producer/operation: no operation with id or key 'nothing'",
      "/operations/0/method: must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE",
      "/operations/0/responses/0/status: must be an integer from 100 to 599",
      "/operations/1/path: must start with '/' and contain no query, fragment or whitespace",
      "/version: must be 1 (the only supported version)",
    ]);
    expect(response.body.apiModel).toBeUndefined();
    expect(response.body.workflow).toBeUndefined();
  });

  it("does not interpret a document that merely resembles a definition", async () => {
    const response = await upload(createApp(), definitionFixture("resembles.json"), "looks-like.json");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unrecognized_input_format");
    expect(response.body.message).toContain("ApiPilot API definition");
  });

  it("leaves no credential value in the response or anything it returns", async () => {
    const response = await upload(createApp(), definitionFixture("credential-example.json"), "creds.json");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("SEEDED-SECRET");
    const issues = model(response.body).summary.issues.filter((issue) => issue.kind === "credential-detected");
    expect(issues).toHaveLength(2);
  });
});

describe("API definition through the guided workflow", () => {
  it("replaces the workflow only when the definition is valid", async () => {
    const agent = request.agent(createApp());
    const first = await agent.post(WORKFLOW).attach("file", openapi("valid.yaml"), "a.yaml");
    const rejected = await agent.post(`${WORKFLOW}?discardExisting=true`).attach("file", definitionFixture("invalid/version.json"), "bad.json");
    expect(rejected.status).toBe(400);
    expect((await agent.get(WORKFLOW)).body.workflow.id).toBe(first.body.workflow.id);
    const replaced = await agent.post(`${WORKFLOW}?discardExisting=true`).attach("file", definitionFixture("valid.json"), "orders.json");
    expect(replaced.status).toBe(200);
    expect(replaced.body.workflow.input.format).toBe("api-definition");
    expect(replaced.body.workflow.activeStageId).toBe("apiReview");
  });
});
