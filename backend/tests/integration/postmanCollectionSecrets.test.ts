import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { approvedTestModel, exportApiModel } from "../fixtures/postman/exportFixtures";

const ENDPOINT = "/api/test-models/postman-collection";
const SUPPLIED_TOKEN = "supplied-secret-token-value";
const SUPPLIED_BASE_URL = "https://qa.internal.example";

async function exportWithValues() {
  return request(createApp())
    .post(ENDPOINT)
    .send({
      apiModel: exportApiModel,
      testModel: approvedTestModel,
      options: { baseUrl: SUPPLIED_BASE_URL, variableValues: { token: SUPPLIED_TOKEN } },
    });
}

describe(`${ENDPOINT} secret handling`, () => {
  it("addresses every request through the base-address variable, never a literal host", async () => {
    const response = await exportWithValues();
    const items = response.body.collection.item.flatMap(
      (folder: { item: { request: { url: { raw: string; host: string[] } } }[] }) => folder.item,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.request.url.raw.startsWith("{{baseUrl}}")).toBe(true);
      expect(item.request.url.host).toEqual(["{{baseUrl}}"]);
    }
    expect(JSON.stringify(response.body.collection)).not.toContain(SUPPLIED_BASE_URL);
  });

  it("keeps supplied credential values out of the collection, the document, and diagnostics", async () => {
    const response = await exportWithValues();
    expect(JSON.stringify(response.body.collection)).not.toContain(SUPPLIED_TOKEN);
    expect(response.body.readme).not.toContain(SUPPLIED_TOKEN);
    expect(JSON.stringify(response.body.validation)).not.toContain(SUPPLIED_TOKEN);
    expect(JSON.stringify(response.body.limitations)).not.toContain(SUPPLIED_TOKEN);
  });

  it("writes supplied credential values only into the environment, marked as secret", async () => {
    const response = await exportWithValues();
    const token = response.body.environment.values.find(
      (value: { key: string }) => value.key === "token",
    );
    expect(token).toEqual({
      key: "token",
      value: SUPPLIED_TOKEN,
      type: "secret",
      enabled: true,
    });
  });

  it("declares every variable the collection references in both artifacts", async () => {
    const response = await exportWithValues();
    const referenced = new Set(
      [...JSON.stringify(response.body.collection).matchAll(/\{\{([^}"]+)\}\}/g)].map(
        (match) => match[1],
      ),
    );
    const inCollection = new Set(
      response.body.collection.variable.map((variable: { key: string }) => variable.key),
    );
    const inEnvironment = new Set(
      response.body.environment.values.map((value: { key: string }) => value.key),
    );
    for (const name of referenced) {
      expect(inCollection).toContain(name);
      expect(inEnvironment).toContain(name);
    }
  });

  it("replaces a credential carried by an approved request with a variable reference", async () => {
    const response = await exportWithValues();
    const serialized = JSON.stringify(response.body.collection);
    expect(serialized).not.toContain("sk-live-supersecret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).toContain("{{token}}");
    expect(serialized).toContain("{{password}}");
  });

  it("refuses a value for a variable the collection does not reference", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({
        apiModel: exportApiModel,
        testModel: approvedTestModel,
        options: { variableValues: { notAVariable: "x" } },
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_variable");
    expect(response.body.collection).toBeUndefined();
  });

  it("declares credential variables with empty values when the engineer supplies none", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({ apiModel: exportApiModel, testModel: approvedTestModel });
    const values = response.body.environment.values as { key: string; value: string }[];
    expect(values.every((value) => value.value === "")).toBe(true);
    expect(values.map((value) => value.key)).toContain("baseUrl");
  });
});
