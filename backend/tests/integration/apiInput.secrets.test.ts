import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { DEFAULT_INPUT_LIMITS } from "../../src/apiInput/limits";
import { loadDefinition } from "../../src/apiInput/definition/loadDefinition";
import { loadHar } from "../../src/apiInput/har/loadHar";
import { analyzeDependencies } from "../../src/dependencies/analyzeDependencies";
import { generateCollection } from "../../src/postman/generateCollection";
import { serializeArtifact } from "../../src/postman/ordering";
import { buildAIScenarioPrompt } from "../../src/testDesign/aiScenarioPrompt";
import { generateTestModelWithNotes } from "../../src/testDesign/generateTestModel";

/**
 * specs/056 SC-004, FR-047, US5: a capture seeded with recognizable secret values (marker prefix
 * `SEEDED-SECRET-`) in headers, cookies, query strings, JSON and form bodies and URL userinfo must
 * leave none of them in any output. Part A (this block) drives the HAR adapter directly, before the
 * HAR family is enabled in the upload routes (T058, the release gate for Story 2); the route-level
 * and generation-level parts follow in later blocks of this file.
 */

const fixture = path.join(__dirname, "..", "fixtures", "apiInput", "har", "seeded-secrets.har");
const rawText = readFileSync(fixture, "utf-8");
const MARKERS = [...new Set(rawText.match(/SEEDED-SECRET-[A-Z0-9]+/g) ?? [])];

function capturedOutput(...spies: ReturnType<typeof vi.spyOn>[]): string {
  return spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" "))).join("\n");
}

describe("HAR adapter: seeded secrets never leave the extraction step (part A, release gate)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("seeds secrets in every location the spec names", () => {
    expect(MARKERS.length).toBeGreaterThanOrEqual(20);
    for (const location of ["PASSWORD", "BEARER", "COOKIE", "QUERYKEY", "FORMSECRET", "MULTIPART", "USERINFO", "MEMO", "JWT", "CSRF", "XAPIKEY", "SETCOOKIE"]) {
      expect(MARKERS.some((marker) => marker.includes(location)), location).toBe(true);
    }
  });

  it("leaves no marker in the model, the report, the issues or the logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const model = await loadHar(JSON.parse(rawText) as Record<string, unknown>, DEFAULT_INPUT_LIMITS);

    const serialized = JSON.stringify(model);
    for (const marker of MARKERS) {
      expect(serialized, `model contains ${marker}`).not.toContain(marker);
      expect(capturedOutput(log, warn, error), `logs contain ${marker}`).not.toContain(marker);
    }
    expect(model.importReport?.counts.total).toBe(6);
  });

  it("records which credentials were seen without any value", async () => {
    const model = await loadHar(JSON.parse(rawText) as Record<string, unknown>, DEFAULT_INPUT_LIMITS);
    const seen = model.operations.flatMap((operation) => operation.observed?.credentialsObserved ?? []);
    const kinds = new Set(seen.map((credential) => `${credential.kind}:${credential.location}`));
    expect(kinds.has("password:body")).toBe(true);
    expect(kinds.has("token:header")).toBe(true);
    expect(kinds.has("cookie:cookie")).toBe(true);
    expect(kinds.has("apiKey:query")).toBe(true);
    for (const credential of seen) expect(Object.keys(credential).sort()).toEqual(["kind", "location", "name", "observations"]);
    expect(model.operations.some((operation) => model.summary.issues.some((issue) => issue.kind === "credential-detected" && issue.location.endsWith(operation.path)))).toBe(true);
  });

  it("reports the credential-bearing URL by position and host, never with the userinfo", async () => {
    const model = await loadHar(JSON.parse(rawText) as Record<string, unknown>, DEFAULT_INPUT_LIMITS);
    expect(model.importReport?.credentialUrlCount).toBe(1);
    expect(model.importReport?.credentialUrlEntries).toEqual([{ entryIndex: 4, host: "api.shop.test" }]);
  });

  it("keeps structure and substitutes placeholders for credential values in examples", async () => {
    const model = await loadHar(JSON.parse(rawText) as Record<string, unknown>, DEFAULT_INPUT_LIMITS);
    const login = model.operations.find((operation) => operation.path === "/v1/login");
    expect(login?.observed?.requestExamples[0].body).toEqual({ username: "ada", password: "[redacted:password]" });
    const orders = model.operations.find((operation) => operation.path === "/v1/orders" && operation.method === "GET");
    expect(orders?.observed?.requestExamples[0].queryParameters).toMatchObject({
      api_key: "[redacted:apiKey]",
      access_token: "[redacted:token]",
      page: "1",
    });
    expect(orders?.observed?.requestExamples[0].headers).toMatchObject({
      authorization: "[redacted:token]",
      cookie: "[redacted:cookie]",
      "x-api-key": "[redacted:apiKey]",
    });
  });
});

describe("seeded secrets through both upload routes (part A, route level, after T059)", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["/api/specifications", "/api/test-generation-workflow"])("%s leaves no marker in the response, the stored workflow or the logs", async (route) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const agent = request.agent(createApp());
    const response = await agent.post(route).attach("file", Buffer.from(rawText), "seeded.har");
    expect(response.status).toBe(200);
    const stored = await agent.get("/api/test-generation-workflow");
    const everything = JSON.stringify(response.body) + JSON.stringify(stored.body ?? {}) + capturedOutput(log, warn, error);
    for (const marker of MARKERS) expect(everything, `output contains ${marker}`).not.toContain(marker);
  });
});

describe("seeded secrets through generation, the AI prompt, dependency analysis and Postman export (part B, T080)", () => {
  afterEach(() => vi.restoreAllMocks());

  async function generate() {
    const model = await loadHar(JSON.parse(rawText) as Record<string, unknown>, DEFAULT_INPUT_LIMITS);
    const { testModel } = generateTestModelWithNotes(model);
    return { model, testModel };
  }

  it("generates scenarios and keeps every marker out of the test model", async () => {
    const { testModel } = await generate();
    expect(testModel.scenarios.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(testModel);
    for (const marker of MARKERS) expect(serialized, `test model contains ${marker}`).not.toContain(marker);
  });

  it("keeps every marker out of the AI scenario prompt, for both purposes", async () => {
    const { model, testModel } = await generate();
    for (const purpose of ["enhance", "replace"] as const) {
      const prompt = buildAIScenarioPrompt(model, testModel, purpose);
      for (const marker of MARKERS) expect(prompt, `${purpose} prompt contains ${marker}`).not.toContain(marker);
    }
  });

  it("keeps every marker out of dependency analysis, which runs without any AI provider", async () => {
    const { model } = await generate();
    const analysis = await analyzeDependencies(model);
    const serialized = JSON.stringify(analysis);
    for (const marker of MARKERS) expect(serialized, `dependency analysis contains ${marker}`).not.toContain(marker);
  });

  it("keeps every marker, and every redaction placeholder, out of the Postman collection, environment and readme", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { model, testModel } = await generate();
    const outcome = generateCollection(model, testModel, { baseUrl: "https://qa.internal.example" });
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}: ${outcome.failure.message}`);
    const artifacts = [outcome.result.collection, outcome.result.environment, outcome.result.readme, outcome.result.limitations, outcome.result.summary]
      .map((part) => serializeArtifact(part))
      .join("\n");
    for (const marker of MARKERS) {
      expect(artifacts, `artifacts contain ${marker}`).not.toContain(marker);
      expect(capturedOutput(log, warn, error), `logs contain ${marker}`).not.toContain(marker);
    }
    expect(artifacts).not.toContain("[redacted:");
    expect(outcome.result.validation).toEqual({ valid: true, problems: [] });
  });
});

describe("seeded secrets in an API definition through generation and Postman export (US6)", () => {
  const definition = {
    format: "apipilot.api-definition",
    version: 1,
    info: { title: "Login API" },
    operations: [
      {
        id: "login",
        method: "POST",
        path: "/login",
        parameters: [{ name: "Authorization", in: "header", example: "Bearer SEEDED-SECRET-DEFHEADER" }],
        requestBody: { contentType: "application/json", examples: [{ name: "ada", value: { user: "ada", password: "SEEDED-SECRET-DEFPASSWORD" } }] },
        responses: [{ status: 200, description: "Signed in." }],
      },
    ],
  };

  it("never lets a declared credential reach the model, the AI prompt or any exported artifact", () => {
    const model = loadDefinition(definition);
    const { testModel } = generateTestModelWithNotes(model);
    const example = testModel.scenarios.find((scenario) => scenario.provenance.rule === "declared-example-positive");
    expect(example?.request.body).toEqual({ user: "ada", password: "[redacted:password]" });
    expect(example?.request.headers).toEqual({ Authorization: "[redacted:token]" });

    const outcome = generateCollection(model, testModel, {});
    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}: ${outcome.failure.message}`);
    const artifacts = [outcome.result.collection, outcome.result.environment, outcome.result.readme, outcome.result.limitations]
      .map((part) => serializeArtifact(part))
      .join("\n");
    const everything = [JSON.stringify(model), JSON.stringify(testModel), buildAIScenarioPrompt(model, testModel), artifacts].join("\n");
    expect(everything).not.toContain("SEEDED-SECRET");
    expect(artifacts).not.toContain("[redacted:");
    expect(artifacts).toContain("{{password}}");
    expect(outcome.result.validation).toEqual({ valid: true, problems: [] });
  });
});
