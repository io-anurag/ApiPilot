import { describe, expect, it, vi } from "vitest";
import { MockProvider } from "../../../src/ai/mockProvider";
import { JSON_INFERENCE_REQUEST, TEXT_INFERENCE_REQUEST } from "../../fixtures/ai/sampleInferenceRequests";

describe("MockProvider", () => {
  it("always reports provider mock and a ready state", () => {
    const provider = new MockProvider();
    expect(provider.mode).toBe("mock");
    expect(provider.getReadiness().state).toBe("ready");
  });

  it("returns identical output for identical input across repeated calls (FR-011, SC-004)", async () => {
    const provider = new MockProvider();

    const first = await provider.infer(TEXT_INFERENCE_REQUEST);
    const second = await provider.infer(TEXT_INFERENCE_REQUEST);

    expect(first.content).toBe(second.content);
    expect(first.provider).toBe("mock");
  });

  it("returns different output for different input", async () => {
    const provider = new MockProvider();

    const textResponse = await provider.infer(TEXT_INFERENCE_REQUEST);
    const jsonResponse = await provider.infer(JSON_INFERENCE_REQUEST);

    expect(textResponse.content).not.toBe(jsonResponse.content);
  });

  it("calls hooks.onStarted before a successful response, and ignores systemPrompt", async () => {
    const provider = new MockProvider();
    const onStarted = vi.fn();

    const plain = await provider.infer(JSON_INFERENCE_REQUEST);
    const withHooks = await provider.infer(
      { ...JSON_INFERENCE_REQUEST, systemPrompt: "different instruction" },
      { onStarted },
    );

    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(withHooks.content).toBe(plain.content);
  });

  it("does not call onStarted for a rejected empty input", async () => {
    const provider = new MockProvider();
    const onStarted = vi.fn();

    await provider.infer(
      { contractVersion: 1, requestId: "empty", input: "", expectedOutputFormat: "text" },
      { onStarted },
    );

    expect(onStarted).not.toHaveBeenCalled();
  });

  it("rejects an empty input as INVALID_REQUEST", async () => {
    const provider = new MockProvider();

    const response = await provider.infer({
      contractVersion: 1,
      requestId: "empty",
      input: "",
      expectedOutputFormat: "text",
    });

    expect(response.status).toBe("error");
    expect(response.errorCategory).toBe("INVALID_REQUEST");
  });
});
