import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { generateBaselineTestSuite } from "../../src/services/testModelsClient";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("testModelsClient logging (FR-010)", () => {
  it("logs a structured entry when a network error is caught", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await generateBaselineTestSuite(apiModel);

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "testModelsClient",
      operation: "generateBaselineTestSuite",
      errorCategory: "network_error",
    });
  });

  it("logs a structured entry when the backend returns a non-2xx response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_api_model", message: "Bad model" }),
      } as Response),
    );

    const result = await generateBaselineTestSuite(apiModel);

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "testModelsClient",
      operation: "generateBaselineTestSuite",
      errorCategory: "invalid_api_model",
      statusCode: 400,
    });
  });
});
