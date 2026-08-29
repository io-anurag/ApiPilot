import { describe, expect, it } from "vitest";
import type { AIProvider, InferenceRequest, ReadinessState } from "@apipilot/shared-domain";
import { MockProvider } from "../../../src/ai/mockProvider";

/** A tiny feature harness that depends only on the AIProvider abstraction (SC-003). */
async function summarize(provider: AIProvider, text: string): Promise<string> {
  const request: InferenceRequest = {
    contractVersion: 1,
    requestId: "swap-test",
    input: text,
    expectedOutputFormat: "text",
  };
  const response = await provider.infer(request);
  if (response.status !== "success" || !response.content) {
    throw new Error("inference failed");
  }
  return response.content;
}

function fakeLocalProvider(): AIProvider {
  return {
    mode: "local",
    getReadiness: (): ReadinessState => ({
      state: "ready",
      modelId: "fake-local",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date().toISOString(),
    }),
    infer: async (request) => ({
      contractVersion: 1,
      requestId: request.requestId,
      status: "success",
      content: `local:${request.input}`,
      modelId: "fake-local",
      provider: "local",
      durationMs: 1,
    }),
  };
}

describe("AIProvider swap", () => {
  it("summarize() behaves correctly whether passed the mock or a fake local provider, with no code changes", async () => {
    const mockResult = await summarize(new MockProvider(), "hello");
    const localResult = await summarize(fakeLocalProvider(), "hello");

    expect(mockResult).toBeTruthy();
    expect(localResult).toBe("local:hello");
  });
});
