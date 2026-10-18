import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { API_DEFINITION_SCHEMA_V1 } from "../../src/apiInput/definition/definitionSchema";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../fixtures/execution/driveWorkflow";

/**
 * specs/056 FR-055, SC-010: the example files shipped in docs/examples upload cleanly, and the numbers
 * the documentation quotes for them are the numbers the application produces. If the product's
 * behaviour changes, this test fails until the documentation is updated with it.
 */

const root = path.resolve(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(path.join(root, relative));
const text = (relative: string) => read(relative).toString("utf-8");

async function uploadExample(file: string): Promise<{ status: number; apiModel: ApiModel; body: Record<string, unknown> }> {
  const response = await request(createApp()).post("/api/specifications").attach("file", read(`docs/examples/${file}`), file);
  return { status: response.status, apiModel: response.body.apiModel as ApiModel, body: response.body as Record<string, unknown> };
}

describe("docs/examples/sample-capture.har", () => {
  it("imports 15 entries as 12 imported, 3 excluded and 5 operations, as the user manual says", async () => {
    const { status, apiModel, body } = await uploadExample("sample-capture.har");
    expect(status).toBe(200);
    expect(body.input).toMatchObject({ format: "har", label: "HAR capture" });
    expect(apiModel.importReport?.counts).toEqual({ total: 15, imported: 12, excluded: 3, malformed: 0, operations: 5 });
    expect(apiModel.importReport?.exclusions.map((group) => [group.reason, group.count]).sort()).toEqual([
      ["analytics-telemetry", 1],
      ["redirect", 1],
      ["static-asset", 1],
    ]);
    const manual = text("docs/USER_MANUAL.md");
    expect(manual).toContain("15 entries");
    expect(manual).toContain("12 imported");
  });

  it("infers the order id as a path parameter and keeps both observed statuses", async () => {
    const { apiModel } = await uploadExample("sample-capture.har");
    const order = apiModel.operations.find((operation) => operation.path === "/v1/orders/{orderId}");
    expect(order?.parameters.find((parameter) => parameter.name === "orderId")?.provenance).toMatchObject({ origin: "inferred", observationCount: 4 });
    expect(order?.responses.map((response) => response.statusCode).sort()).toEqual(["200", "404"]);
    expect(apiModel.operations.map((operation) => `${operation.method} ${operation.path}`).sort()).toEqual([
      "GET /v1/orders",
      "GET /v1/orders/{orderId}",
      "GET /v1/receipts",
      "POST /v1/feedback",
      "POST /v1/orders",
    ]);
  });

  it("shows two observed dependency hints, never a confirmed one", async () => {
    const { apiModel } = await uploadExample("sample-capture.har");
    expect(apiModel.dependencyHints?.map((hint) => `${hint.producer.operationPath}.${hint.producer.field} -> ${hint.consumer.operationPath}.${hint.consumer.field}`)).toEqual([
      "/v1/orders.id -> /v1/orders/{orderId}.orderId",
      "/v1/orders.id -> /v1/receipts.orderRef",
    ]);
  });

  it("contains nothing credential-shaped, so it is safe to share", () => {
    const raw = text("docs/examples/sample-capture.har");
    const entries = (JSON.parse(raw) as { log: { entries: { request: { cookies: unknown[]; headers: { name: string }[] }; response: { cookies: unknown[]; headers: { name: string }[] } }[] } }).log.entries;
    for (const entry of entries) {
      expect(entry.request.cookies).toEqual([]);
      expect(entry.response.cookies).toEqual([]);
      for (const header of [...entry.request.headers, ...entry.response.headers]) {
        expect(header.name.toLowerCase()).not.toMatch(/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/);
      }
    }
    expect(raw).not.toMatch(/bearer |password|api[_-]?key|secret|token/i);
  });
});

describe("docs/examples/sample-api-definition.json", () => {
  it("imports as a definition with 2 operations and one confirmed dependency, as the format page says", async () => {
    const { status, apiModel, body } = await uploadExample("sample-api-definition.json");
    expect(status).toBe(200);
    expect(body.input).toMatchObject({ format: "api-definition", label: "ApiPilot API definition" });
    expect(apiModel.summary.operationCount).toBe(2);
    expect(apiModel.dependencyHints?.[0]).toMatchObject({ origin: "declared", verified: true });
    expect(text("docs/api-definition-format.md")).toContain("It yields 2 operations");
  });

  it("is the example printed in the format page", () => {
    const page = text("docs/api-definition-format.md");
    const printed = /## Example\s+```json\r?\n([\s\S]*?)```/.exec(page)?.[1];
    expect(JSON.parse(printed ?? "null")).toEqual(JSON.parse(text("docs/examples/sample-api-definition.json")));
  });
});

describe("docs/examples/sample-openapi.json", () => {
  it("imports as OpenAPI (JSON) with the same 3 operations as the YAML fixture", async () => {
    const { status, apiModel, body } = await uploadExample("sample-openapi.json");
    expect(status).toBe(200);
    expect(body.input).toMatchObject({ format: "openapi-json" });
    expect(apiModel.summary.operationCount).toBe(3);
  });
});

describe("the published definition schema", () => {
  it("is identical in docs, in the contract and in the code", () => {
    const contract = JSON.parse(text("specs/056-har-json-input-support/contracts/api-definition.v1.schema.json"));
    expect(JSON.parse(text("docs/api-definition.v1.schema.json"))).toEqual(contract);
    expect(API_DEFINITION_SCHEMA_V1).toEqual(contract);
  });
});

describe("the examples carry through every stage to generated Postman artifacts (quickstart walkthrough)", () => {
  it.each([
    ["sample-capture.har", "har"],
    ["sample-api-definition.json", "api-definition"],
    ["sample-openapi.json", "openapi-json"],
  ])("%s", async (file, format) => {
    resetStore();
    const agent = request.agent(createApp());
    const workflow = await driveToPostmanGenerationComplete(agent, { specification: { buffer: read(`docs/examples/${file}`), filename: file } });
    expect(workflow.input?.format).toBe(format);
    expect(workflow.stages.postmanGeneration.status).toBe("complete");
    expect(workflow.postmanArtifact?.validation).toEqual({ valid: true, problems: [] });
    expect((workflow.approvedTestModel?.scenarios.length ?? 0)).toBeGreaterThan(0);
  });
});
