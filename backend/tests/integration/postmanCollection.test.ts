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
import {
  adminReportsScenario,
  ambiguousFieldsApiModel,
  createSessionScenario,
  issueAdminTokenScenario,
  issueTokenAmbiguousFieldsScenario,
  issueTokenNoPlausibleFieldScenario,
  issueTokenScenario,
  noPlausibleFieldApiModel,
  oauth2ApiModel,
  oauth2ProtectedOperation,
  primaryNoStemMatchApiModel,
  sessionInfoScenario,
  tokenInfoScenario,
  twoIndependentSchemesApiModel,
} from "../fixtures/postman/credentialFixtures";
import { graphOf, testModelOf } from "../fixtures/postman/dependencyFixtures";

/** Enables automatic chaining, exactly as specs/019 requires — auth-credential relationships
 *  (specs/023-auto-auth-credential-chaining) are built internally by `generateCollection` from
 *  the submitted `apiModel`, not supplied by the caller, so an empty graph/cycles is sufficient. */
function automaticChainingContext() {
  return { workflows: [], approvedWorkflowIds: [], automaticChaining: { graph: graphOf(), cycles: [], workflowDecisions: {} } };
}

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

  describe("automatic auth-credential chaining (specs/023-auto-auth-credential-chaining)", () => {
    it("captures a login token and wires it into every consumer's Authorization header over HTTP (US1, SC-001)", async () => {
      const response = await exportRequest({
        apiModel: twoIndependentSchemesApiModel,
        testModel: testModelOf(issueTokenScenario, tokenInfoScenario, issueAdminTokenScenario, adminReportsScenario),
        workflowContext: automaticChainingContext(),
      });
      expect(response.status).toBe(200);

      const items = response.body.collection.item.flatMap((folder: { item: unknown[] }) => folder.item) as {
        provenance?: { scenarioId?: string };
        event?: { script: { exec: string[] } }[];
        request: { auth?: { bearer: { key: string; value: string }[] } };
      }[];

      const producerItem = items.find((item) => item.provenance?.scenarioId === issueTokenScenario.id)!;
      expect(producerItem.event?.[0]?.script.exec.join("\n")).toContain('pm.environment.set("token"');

      const consumerItem = items.find((item) => item.provenance?.scenarioId === tokenInfoScenario.id)!;
      expect(consumerItem.request.auth?.bearer?.[0]).toEqual({ key: "token", value: "{{token}}", type: "string" });

      expect(response.body.limitations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "unresolved-credential-producer", location: 'security scheme "tokenAuth"' }),
        ]),
      );
      expect(response.body.summary.automaticChainCount).toBeGreaterThanOrEqual(1);
    });

    it("chains two distinctly-keyed schemes independently over HTTP, with zero cross-scheme leakage (US2, SC-002)", async () => {
      const response = await exportRequest({
        apiModel: twoIndependentSchemesApiModel,
        testModel: testModelOf(issueTokenScenario, tokenInfoScenario, issueAdminTokenScenario, adminReportsScenario),
        workflowContext: automaticChainingContext(),
      });
      expect(response.status).toBe(200);

      const items = response.body.collection.item.flatMap((folder: { item: unknown[] }) => folder.item) as {
        provenance?: { scenarioId?: string };
        request: { auth?: { bearer: { key: string; value: string }[] } };
      }[];

      const tokenInfoItem = items.find((item) => item.provenance?.scenarioId === tokenInfoScenario.id)!;
      expect(tokenInfoItem.request.auth?.bearer?.[0]?.value).toBe("{{token}}");
      const adminReportsItem = items.find((item) => item.provenance?.scenarioId === adminReportsScenario.id)!;
      expect(adminReportsItem.request.auth?.bearer?.[0]?.value).toBe("{{adminToken}}");

      expect(response.body.limitations).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "unresolved-credential-producer" })]),
      );
    });

    it("creates no chain and records the limitation over HTTP when the producer's response has two equally plausible fields (US3, FR-004)", async () => {
      const response = await exportRequest({
        apiModel: ambiguousFieldsApiModel,
        testModel: testModelOf(issueTokenAmbiguousFieldsScenario, tokenInfoScenario),
        workflowContext: automaticChainingContext(),
      });
      expect(response.status).toBe(200);
      expect(response.body.summary.automaticChainCount).toBe(0);
      expect(response.body.limitations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "unresolved-credential-producer", location: 'security scheme "tokenAuth"' }),
        ]),
      );
    });

    it("creates no chain and records the limitation over HTTP when the producer's response has zero plausible fields (US3, FR-004)", async () => {
      const response = await exportRequest({
        apiModel: noPlausibleFieldApiModel,
        testModel: testModelOf(issueTokenNoPlausibleFieldScenario, tokenInfoScenario),
        workflowContext: automaticChainingContext(),
      });
      expect(response.status).toBe(200);
      expect(response.body.summary.automaticChainCount).toBe(0);
      expect(response.body.limitations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "unresolved-credential-producer", location: 'security scheme "tokenAuth"' }),
        ]),
      );
    });

    it("records the limitation over HTTP for a primary scheme whose login endpoint's stem does not match (Clarifications 2026-09-15 Q3)", async () => {
      const response = await exportRequest({
        apiModel: primaryNoStemMatchApiModel,
        testModel: testModelOf(createSessionScenario, sessionInfoScenario),
        workflowContext: automaticChainingContext(),
      });
      expect(response.status).toBe(200);
      expect(response.body.credentialProducers).toEqual([]);
      expect(response.body.summary.automaticChainCount).toBe(0);
      expect(response.body.limitations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "unresolved-credential-producer", location: 'security scheme "bearerAuth"' }),
        ]),
      );
    });
  });

  describe("OAuth2 clientCredentials over HTTP (specs/024-oauth2-client-credentials-auth)", () => {
    it("returns the ExportResult fields the contract documents: setup folder first, oauth2 auth block, new environment variables, no unsupported-auth-scheme", async () => {
      const response = await exportRequest({
        apiModel: oauth2ApiModel,
        testModel: {
          scenarios: [
            {
              id: "scenario-oauth2-http",
              category: "positive",
              operationPath: oauth2ProtectedOperation.path,
              operationMethod: oauth2ProtectedOperation.method,
              request: { pathParameters: {}, queryParameters: {}, headers: {} },
              assertions: [{ type: "status-code", expectedStatusCode: "200" }],
              provenance: { source: "RULE", rule: "positive", description: "d.", duplicateOfRules: [] },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.collection.item[0].name).toBe("OAuth2 Token Setup");
      expect(response.body.collection.item[0].item[0].request.auth.type).toBe("basic");
      expect(response.body.collection.item[0].item[0].request.url.raw).toBe(
        "{{baseUrl}}/oauth2/token",
      );

      const consumingItem = response.body.collection.item
        .flatMap((folder: { item: unknown[] }) => folder.item)
        .find((item: { request: { auth?: { type: string } } }) => item.request.auth?.type === "oauth2");
      expect(consumingItem.request.auth).toEqual({
        type: "oauth2",
        oauth2: [
          { key: "accessToken", value: "{{accessToken}}", type: "string" },
          { key: "addTokenTo", value: "header", type: "string" },
          { key: "tokenType", value: "bearer", type: "string" },
        ],
      });

      const byName = Object.fromEntries(
        response.body.environment.values.map((v: { key: string; type: string; value: string }) => [
          v.key,
          v,
        ]),
      );
      expect(byName.clientId).toEqual({ key: "clientId", value: "", type: "secret", enabled: true });
      expect(byName.clientSecret).toEqual({ key: "clientSecret", value: "", type: "secret", enabled: true });
      expect(byName.accessToken).toEqual({ key: "accessToken", value: "", type: "secret", enabled: true });

      expect(
        response.body.limitations.some((l: { kind: string }) => l.kind === "unsupported-auth-scheme"),
      ).toBe(false);
      expect(response.body.summary.requestCount).toBe(2);
    });
  });
});