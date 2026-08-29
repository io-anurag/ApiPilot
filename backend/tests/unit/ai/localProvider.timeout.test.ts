import { describe, expect, it } from "vitest";
import { LocalProvider } from "../../../src/ai/localProvider";
import { TEXT_INFERENCE_REQUEST } from "../../fixtures/ai/sampleInferenceRequests";

describe("LocalProvider timeout handling", () => {
  it("resolves with a TIMEOUT error when inference exceeds the configured timeout", async () => {
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 20 },
      async () => ({
        generate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return "too slow";
        },
      }),
    );

    const response = await provider.infer(TEXT_INFERENCE_REQUEST);

    expect(response.status).toBe("error");
    expect(response.errorCategory).toBe("TIMEOUT");
  });

  it("succeeds when inference completes within the configured timeout", async () => {
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      async () => ({ generate: async (input: string) => `echo:${input}` }),
    );

    const response = await provider.infer(TEXT_INFERENCE_REQUEST);

    expect(response.status).toBe("success");
    expect(response.content).toContain("echo:");
  });
});
