import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation, TestModel, TestScenario } from "@apipilot/shared-domain";
import { runSingleItem } from "../../../src/execution/newmanRunner";
import { generateCollection } from "../../../src/postman/generateCollection";

/**
 * specs/056 FR-056: Newman, run against a local test server on a loopback port (no external
 * network), receives form-encoded and multipart bodies the exporter generated, with each redaction
 * placeholder replaced by the value the user supplies through the environment.
 */

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let baseUrl: string;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf-8") });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function operation(path: string, contentType: string): ApiOperation {
  return {
    path,
    method: "POST",
    operationId: undefined,
    parameters: [],
    requestBody: { required: false, contentTypes: { [contentType]: { required: [], properties: {} } } },
    responses: [{ statusCode: "200", description: "", contentTypes: {}, examples: {} }],
    security: [],
    tags: [],
    provenance: { origin: "observed", observationCount: 3, confidence: "high" },
  };
}

function scenario(path: string, body: unknown, headers: Record<string, unknown> = {}): TestScenario {
  return {
    id: `s-${path}`,
    operationPath: path,
    operationMethod: "POST",
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers, body },
    assertions: [{ type: "status-code", expectedStatusCode: "200", basis: "observed" }],
    provenance: { source: "RULE", rule: "observed-example-positive", description: "observed", duplicateOfRules: [] },
  };
}

async function run(path: string, contentType: string, body: unknown, headers: Record<string, unknown> = {}) {
  const apiModel: ApiModel = {
    operations: [operation(path, contentType)],
    securitySchemes: {},
    summary: { operationCount: 1, schemaCount: 0, securitySchemeCount: 0, issues: [] },
  };
  const testModel: TestModel = { scenarios: [scenario(path, body, headers)] };
  const outcome = generateCollection(apiModel, testModel, { baseUrl });
  if (!outcome.ok) throw new Error(outcome.failure.message);
  const item = outcome.result.collection.item[0].item[0];
  const declaredVariables = outcome.result.environment.values.map((value) => ({ key: value.key, value: "" }));
  const before = received.length;
  const result = await runSingleItem({
    item,
    collectionAuth: undefined,
    declaredVariables,
    environment: { baseUrl, token: "supplied-token-value", apiKey: "supplied-key-value" },
  });
  expect(result.execution.response?.code).toBe(200);
  expect(received.length).toBe(before + 1);
  return received[received.length - 1];
}

describe("Newman sends generated form-style bodies", () => {
  it("sends an urlencoded body with the supplied value in place of a redacted credential", async () => {
    const request = await run("/v1/import", "application/x-www-form-urlencoded", { source: "csv", dryRun: "true", client_secret: "[redacted:token]" });
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const fields = new URLSearchParams(request.body);
    expect(Object.fromEntries(fields)).toEqual({ source: "csv", dryRun: "true", client_secret: "supplied-token-value" });
    expect(request.body).not.toContain("redacted");
  });

  it("sends a multipart body of text fields with a boundary Newman chose, not a captured one", async () => {
    const request = await run("/v1/attachments", "multipart/form-data", { title: "hello", memo: "[redacted:apiKey]" }, { "content-type": "multipart/form-data; boundary=----captured-boundary" });
    expect(request.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(request.headers["content-type"]).not.toContain("captured-boundary");
    expect(request.body).toMatch(/Content-Disposition: form-data; name="title"\r?\n\r?\nhello/);
    // The placeholder sat under an ordinary field name, so its kind (apiKey) chose the variable.
    expect(request.body).toMatch(/name="memo"\r?\n\r?\nsupplied-key-value/);
    expect(request.body).not.toContain("redacted");
  });
});
