import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { approvedTestModel, exportApiModel, minimalApiModel, minimalTestModel } from "../fixtures/postman/exportFixtures";

const ENDPOINT = "/api/test-models/postman-collection";
const SUPPLIED_TOKEN = "supplied-secret-token-value";
const PAYLOAD_MARKER = "0f7d1c1e-0000-4000-8000-000000000000";

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe(`${ENDPOINT} diagnostics`, () => {
  it("keeps specification content, payloads, and values out of the log during a successful export", async () => {
    await request(createApp())
      .post(ENDPOINT)
      .send({
        apiModel: exportApiModel,
        testModel: approvedTestModel,
        options: { baseUrl: "https://qa.internal.example", variableValues: { token: SUPPLIED_TOKEN } },
      });

    const output = logged.join("\n");
    expect(output).not.toContain(SUPPLIED_TOKEN);
    expect(output).not.toContain(PAYLOAD_MARKER);
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("sk-live-supersecret");
  });

  it("keeps payloads and values out of a refusal response and the log", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({
        apiModel: minimalApiModel,
        testModel: {
          scenarios: [
            minimalTestModel.scenarios[0],
            { ...minimalTestModel.scenarios[0], category: "invalid-type" },
          ],
        },
        options: { variableValues: { baseUrl: SUPPLIED_TOKEN } },
      });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain(SUPPLIED_TOKEN);
    expect(logged.join("\n")).not.toContain(SUPPLIED_TOKEN);
  });

  it("returns a safe error body carrying no stack trace or filesystem path", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({ apiModel: exportApiModel, testModel: { scenarios: [] } });

    expect(response.status).toBe(400);
    expect(response.body.stack).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Za-z]:\\|\/src\/|node_modules/);
  });
});
