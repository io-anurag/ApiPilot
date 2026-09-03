import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import {
  approvedTestModel,
  exportApiModel,
  minimalApiModel,
  minimalTestModel,
} from "../fixtures/postman/exportFixtures";

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
});