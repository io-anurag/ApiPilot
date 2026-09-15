import request from "supertest";
import { describe, expect, it } from "vitest";
import type { TestModel } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import {
  approvedTestModel,
  exportApiModel,
  minimalApiModel,
  minimalTestModel,
} from "../fixtures/postman/exportFixtures";
import { adminAuthOperation, bearerAuthOperation, twoBearerSchemeApiModel } from "../fixtures/postman/credentialFixtures";
import {
  coordsMatrixOperation,
  filterDeepObjectOperation,
  parameterApiModel,
  sortDefaultOperation,
} from "../fixtures/postman/parameterFixtures";

const ENDPOINT = "/api/test-models/postman-collection";

function exportRequest(body: unknown) {
  return request(createApp()).post(ENDPOINT).send(body as object);
}

describe(`POST ${ENDPOINT}`, () => {
  it("returns the collection, environment, document, validation report, limitations, and summary", async () => {
    const response = await exportRequest({
      apiModel: exportApiModel,
      testModel: approvedTestModel,
    });

    expect(response.status).toBe(200);
    expect(response.body.collection.info.schema).toContain("v2.1.0");
    expect(response.body.environment._postman_variable_scope).toBe("environment");
    expect(typeof response.body.readme).toBe("string");
    expect(response.body.validation).toEqual({ valid: true, problems: [] });
    expect(Array.isArray(response.body.limitations)).toBe(true);
    expect(response.body.summary.requestCount).toBe(approvedTestModel.scenarios.length);
  });

  it("emits one request per approved scenario and no request for anything else", async () => {
    const response = await exportRequest({
      apiModel: exportApiModel,
      testModel: approvedTestModel,
    });
    const items = response.body.collection.item.flatMap(
      (folder: { item: unknown[] }) => folder.item,
    );
    expect(items).toHaveLength(approvedTestModel.scenarios.length);
  });

  it("returns an identical body for a repeated identical request", async () => {
    const body = { apiModel: minimalApiModel, testModel: minimalTestModel };
    const first = await exportRequest(body);
    const second = await exportRequest(body);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
  });

  it("rejects a body missing the required models", async () => {
    const response = await exportRequest({ apiModel: exportApiModel });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });

  it("rejects an options object whose values are not strings", async () => {
    const response = await exportRequest({
      apiModel: minimalApiModel,
      testModel: minimalTestModel,
      options: { variableValues: { baseUrl: 42 } },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });

  it("refuses an empty approved test model", async () => {
    const response = await exportRequest({
      apiModel: minimalApiModel,
      testModel: { scenarios: [] },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("empty_approved_test_model");
    expect(response.body.collection).toBeUndefined();
  });

  it("refuses a scenario referencing an operation the API model does not contain", async () => {
    const response = await exportRequest({
      apiModel: minimalApiModel,
      testModel: {
        scenarios: [{ ...minimalTestModel.scenarios[0], operationPath: "/absent" }],
      },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_operation");
  });

  it("refuses a test model carrying multi-step workflow intent", async () => {
    const response = await exportRequest({
      apiModel: minimalApiModel,
      testModel: {
        scenarios: [{ ...minimalTestModel.scenarios[0], steps: [{ extract: { id: "$.id" } }] }],
      },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("workflow_intent_unsupported");
  });

  it("rejects a non-POST method", async () => {
    const response = await request(createApp()).get(ENDPOINT);
    expect(response.status).toBe(405);
    expect(response.body.error).toBe("method_not_allowed");
  });

  it("issues no request to any host described by the specification", async () => {
    const fetchSpy = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("the export must not issue a network request");
    }) as typeof globalThis.fetch;
    try {
      await exportRequest({ apiModel: exportApiModel, testModel: approvedTestModel });
    } finally {
      globalThis.fetch = fetchSpy;
    }
    expect(called).toBe(false);
  });

  it("routes a distinct security scheme's operation to its own derived variable over HTTP (specs/021-multi-credential-token-provisioning)", async () => {
    const testModel: TestModel = {
      scenarios: [
        {
          id: "scenario-orders",
          category: "positive",
          operationPath: bearerAuthOperation.path,
          operationMethod: bearerAuthOperation.method,
          request: { pathParameters: {}, queryParameters: {}, headers: {} },
          assertions: [{ type: "status-code", expectedStatusCode: "200" }],
          provenance: { source: "RULE", rule: "positive", description: "GET /orders.", duplicateOfRules: [] },
        },
        {
          id: "scenario-reports",
          category: "positive",
          operationPath: adminAuthOperation.path,
          operationMethod: adminAuthOperation.method,
          request: { pathParameters: {}, queryParameters: {}, headers: {} },
          assertions: [{ type: "status-code", expectedStatusCode: "200" }],
          provenance: { source: "RULE", rule: "positive", description: "GET /reports.", duplicateOfRules: [] },
        },
      ],
    };

    const response = await exportRequest({ apiModel: twoBearerSchemeApiModel, testModel });

    expect(response.status).toBe(200);
    const values: { key: string; value: string }[] = response.body.environment.values;
    expect(values.map((variable) => variable.key)).toEqual(expect.arrayContaining(["token", "adminToken"]));

    const items = response.body.collection.item.flatMap((folder: { item: { name: string; request: { auth?: { bearer: { value: string }[] } } }[] }) => folder.item);
    const ordersItem = items.find((item: { name: string }) => item.name.includes("GET /orders"));
    const reportsItem = items.find((item: { name: string }) => item.name.includes("GET /reports"));
    expect(ordersItem.request.auth?.bearer?.[0]?.value).toBe("{{token}}");
    expect(reportsItem.request.auth?.bearer?.[0]?.value).toBe("{{adminToken}}");
  });

  it("preserves byte-identical single-scheme output for a repeated identical request (SC-001)", async () => {
    const body = { apiModel: exportApiModel, testModel: approvedTestModel };
    const response = await exportRequest(body);
    expect(response.status).toBe(200);
    expect(response.body.environment.values.map((variable: { key: string }) => variable.key)).toEqual(
      expect.arrayContaining(["token", "username", "password", "apiKey"]),
    );
  });

  it("serializes array and object query parameters per their declared style over HTTP, round-trip-parsing back to the same shape (specs/022-openapi-parameter-serialization, US1, SC-001)", async () => {
    const testModel: TestModel = {
      scenarios: [
        {
          id: "scenario-sort",
          category: "positive",
          operationPath: sortDefaultOperation.path,
          operationMethod: sortDefaultOperation.method,
          request: { pathParameters: {}, queryParameters: { sort: ["name", "-price"] }, headers: {} },
          assertions: [{ type: "status-code", expectedStatusCode: "200" }],
          provenance: { source: "RULE", rule: "positive", description: "GET /catalog with sort.", duplicateOfRules: [] },
        },
        {
          id: "scenario-filter",
          category: "positive",
          operationPath: filterDeepObjectOperation.path,
          operationMethod: filterDeepObjectOperation.method,
          request: {
            pathParameters: {},
            queryParameters: { filter: { status: "active", owner: "alice" } },
            headers: {},
          },
          assertions: [{ type: "status-code", expectedStatusCode: "200" }],
          provenance: { source: "RULE", rule: "positive", description: "GET /catalog with filter.", duplicateOfRules: [] },
        },
      ],
    };

    const response = await exportRequest({ apiModel: parameterApiModel, testModel });
    expect(response.status).toBe(200);

    const items = response.body.collection.item.flatMap(
      (folder: { item: { name: string; request: { url: { raw: string; query: { key: string; value: string }[] } } }[] }) =>
        folder.item,
    );
    const sortItem = items.find((item: { request: { url: { query: { key: string }[] } } }) =>
      item.request.url.query.some((q) => q.key === "sort"),
    );
    const filterItem = items.find((item: { request: { url: { query: { key: string }[] } } }) =>
      item.request.url.query.some((q) => q.key.startsWith("filter")),
    );

    // Array, form/explode:true (default): repeated key=value entries, round-trip-parsed via
    // URLSearchParams back to the original array — not a JSON-stringified literal.
    expect(sortItem.request.url.query).toEqual([
      { key: "sort", value: "name" },
      { key: "sort", value: "-price" },
    ]);
    const sortParsed = new URLSearchParams(sortItem.request.url.raw.split("?")[1]);
    expect(sortParsed.getAll("sort")).toEqual(["name", "-price"]);

    // Object, deepObject: one key[property]=value entry per property, round-trip-parsed back
    // into the original object shape.
    expect(filterItem.request.url.query).toEqual([
      { key: "filter[status]", value: "active" },
      { key: "filter[owner]", value: "alice" },
    ]);
    const filterParsed = new URLSearchParams(filterItem.request.url.raw.split("?")[1]);
    const reconstructed: Record<string, string> = {};
    for (const [key, value] of filterParsed.entries()) {
      const match = /^filter\[(.+)\]$/.exec(key);
      if (match) reconstructed[match[1]] = value;
    }
    expect(reconstructed).toEqual({ status: "active", owner: "alice" });
  });

  it("percent-encodes a boundary value containing & so it round-trip-parses back to the original value over HTTP (specs/022-openapi-parameter-serialization, US2, SC-001, SC-002)", async () => {
    const testModel: TestModel = {
      scenarios: [
        {
          id: "scenario-sort-boundary",
          category: "string-boundary",
          operationPath: sortDefaultOperation.path,
          operationMethod: sortDefaultOperation.method,
          request: { pathParameters: {}, queryParameters: { sort: "a&b=c" }, headers: {} },
          assertions: [{ type: "status-code", expectedStatusCode: "200" }],
          provenance: { source: "RULE", rule: "string-boundary", description: "boundary value containing &.", duplicateOfRules: [] },
        },
      ],
    };

    const response = await exportRequest({ apiModel: parameterApiModel, testModel });
    expect(response.status).toBe(200);

    const items = response.body.collection.item.flatMap(
      (folder: { item: { request: { url: { raw: string } } }[] }) => folder.item,
    );
    const sortItem = items[0];
    expect(sortItem.request.url.raw).not.toContain("a&b=c");
    const parsed = new URLSearchParams(sortItem.request.url.raw.split("?")[1]);
    expect(parsed.get("sort")).toBe("a&b=c");
  });

  it("still exports a runnable request for an unimplemented-style parameter and records the limitation over HTTP (specs/022-openapi-parameter-serialization, US3, FR-007, SC-003)", async () => {
    const testModel: TestModel = {
      scenarios: [
        {
          id: "scenario-coords",
          category: "positive",
          operationPath: coordsMatrixOperation.path,
          operationMethod: coordsMatrixOperation.method,
          request: { pathParameters: { coords: [1, 2] }, queryParameters: {}, headers: {} },
          assertions: [{ type: "status-code", expectedStatusCode: "200" }],
          provenance: { source: "RULE", rule: "positive", description: "GET /locations/{coords}.", duplicateOfRules: [] },
        },
      ],
    };

    const response = await exportRequest({ apiModel: parameterApiModel, testModel });
    expect(response.status).toBe(200);

    const items = response.body.collection.item.flatMap(
      (folder: { item: unknown[] }) => folder.item,
    );
    expect(items).toHaveLength(1);
    expect(response.body.limitations).toContainEqual(
      expect.objectContaining({ kind: "unresolved-parameter-style", scenarioId: "scenario-coords" }),
    );
  });
});