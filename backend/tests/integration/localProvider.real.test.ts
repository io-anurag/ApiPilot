import { describe, expect, it } from "vitest";
import {
  ACCELERATOR_CANARY_INPUT,
  ACCELERATOR_CANARY_MAX_NEW_TOKENS,
  evaluateCanaryReply,
} from "../../src/ai/acceleratorVerification";
import { LocalProvider, loadTransformersEngine } from "../../src/ai/localProvider";

const REAL_MODEL_ENABLED = process.env.AI_TEST_REAL_MODEL === "1";

// Gated behind an explicit opt-in so the default `npm test` run never downloads or
// loads a real model (constitution XXI). Run via `npm run test:ai-real -w backend`.
describe.runIf(REAL_MODEL_ENABLED)("LocalProvider (real model, opt-in)", () => {
  it("completes an inference call fully offline once the model is cached", async () => {
    const provider = new LocalProvider({
      modelId: process.env.AI_MODEL_ID ?? "onnx-community/Qwen3-1.7B-ONNX",
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
      modelId: process.env.AI_MODEL_ID ?? "onnx-community/Qwen3-1.7B-ONNX",
      cacheDir: process.env.AI_MODEL_CACHE_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE}/.apipilot/models`,
      useAccelerator: false,
      inferenceTimeoutMs: 120_000,
    });

    // The default model (Qwen3-1.7B) has a 40960-token context window and Qwen2.5-0.5B a 32768-token
    // one; repeating a short word 60,000 times exceeds either without a multi-megabyte fixture.
    const oversizedInput = "token ".repeat(60_000);

    const response = await provider.infer({
      contractVersion: 1,
      requestId: "real-model-oversized-input-test",
      input: oversizedInput,
      expectedOutputFormat: "text",
    });

    expect(response.status).toBe("error");
    expect(response.errorCategory).toBe("INVALID_REQUEST");
  }, 120_000);

  // Calibration guard for the accelerator canary (specs/055-accelerator-canary-check, research
  // Decision 2): its wording is load-bearing, because two natural phrasings make a healthy small
  // model answer `{}`. The canary runs only on an accelerated load, so this checks the reference
  // device: the configured model must pass it on CPU. Re-run it for every shipped model whenever
  // the canary text, cap or pass rule changes.
  it("passes the accelerator verification canary on CPU for the configured model", async () => {
    const engine = await loadTransformersEngine(
      {
        modelId: process.env.AI_MODEL_ID ?? "onnx-community/Qwen3-1.7B-ONNX",
        cacheDir: process.env.AI_MODEL_CACHE_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE}/.apipilot/models`,
        useAccelerator: false,
        inferenceTimeoutMs: 120_000,
      },
      "cpu",
    );

    const reply = await engine.generate(ACCELERATOR_CANARY_INPUT, {
      maxNewTokens: ACCELERATOR_CANARY_MAX_NEW_TOKENS,
      expectedOutputFormat: "json",
    });

    expect(evaluateCanaryReply(reply)).toEqual({ passed: true });
    await engine.dispose?.();
  }, 120_000);
});
