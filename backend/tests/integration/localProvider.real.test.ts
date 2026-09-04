import { describe, expect, it } from "vitest";
import { LocalProvider } from "../../src/ai/localProvider";

const REAL_MODEL_ENABLED = process.env.AI_TEST_REAL_MODEL === "1";

// Gated behind an explicit opt-in so the default `npm test` run never downloads or
// loads a real model (constitution XXI). Run via `npm run test:ai-real -w backend`.
describe.runIf(REAL_MODEL_ENABLED)("LocalProvider (real model, opt-in)", () => {
  it("completes an inference call fully offline once the model is cached", async () => {
    const provider = new LocalProvider({
      modelId: process.env.AI_MODEL_ID ?? "onnx-community/Qwen2.5-0.5B-Instruct",
      cacheDir: process.env.AI_MODEL_CACHE_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE}/.apipilot/models`,
      useAccelerator: false,
      inferenceTimeoutMs: 120_000,
    });

    const response = await provider.infer({
      contractVersion: 1,
      requestId: "real-model-smoke-test",
      input: "Say hello in one short sentence.",
      expectedOutputFormat: "text",
    });

    expect(response.status).toBe("success");
    expect(response.content).toBeTruthy();
  }, 120_000);

  it("rejects an input that exceeds the model's context window as INVALID_REQUEST instead of crashing onnxruntime", async () => {
    const provider = new LocalProvider({
      modelId: process.env.AI_MODEL_ID ?? "onnx-community/Qwen2.5-0.5B-Instruct",
      cacheDir: process.env.AI_MODEL_CACHE_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE}/.apipilot/models`,
      useAccelerator: false,
      inferenceTimeoutMs: 120_000,
    });

    // Qwen2.5-0.5B-Instruct has a 32768-token context window; repeating a short word
    // comfortably exceeds it without needing a multi-megabyte fixture.
    const oversizedInput = "token ".repeat(40_000);

    const response = await provider.infer({
      contractVersion: 1,
      requestId: "real-model-oversized-input-test",
      input: oversizedInput,
      expectedOutputFormat: "text",
    });

    expect(response.status).toBe("error");
    expect(response.errorCategory).toBe("INVALID_REQUEST");
  }, 120_000);
});
