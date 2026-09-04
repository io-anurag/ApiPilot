import http from "node:http";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import { analyzeDependencies } from "../../../src/dependencies/analyzeDependencies";
import { crudChainApiModel } from "../../fixtures/dependencies/dependencyFixtures";

/** FR-019 and SC-009: analysis issues no request to any API described by the ApiModel. */

function mockProvider(): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getInputBudget: async () => undefined,
    infer: async (input): Promise<InferenceResponse> => ({
      contractVersion: 1,
      requestId: input.requestId,
      status: "success",
      content: JSON.stringify({ responseVersion: 1, candidates: [] }),
      modelId: "test-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dependency analysis network isolation", () => {
  it("issues no fetch, http, or https request while analyzing", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("analysis must not issue a network request");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const httpRequest = vi.spyOn(http, "request").mockImplementation(() => {
      throw new Error("analysis must not issue a network request");
    });
    const httpGet = vi.spyOn(http, "get").mockImplementation(() => {
      throw new Error("analysis must not issue a network request");
    });
    const httpsRequest = vi.spyOn(https, "request").mockImplementation(() => {
      throw new Error("analysis must not issue a network request");
    });
    const httpsGet = vi.spyOn(https, "get").mockImplementation(() => {
      throw new Error("analysis must not issue a network request");
    });

    const result = await analyzeDependencies(crudChainApiModel, mockProvider());

    expect(result.aiOutcome).toBe("success");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpGet).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(httpsGet).not.toHaveBeenCalled();
  });
});
