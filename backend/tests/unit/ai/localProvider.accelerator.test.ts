import { describe, expect, it } from "vitest";
import { LocalProvider } from "../../../src/ai/localProvider";

describe("LocalProvider accelerator fallback", () => {
  it("falls back to CPU and reports a visible notice when the accelerator is unavailable", async () => {
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: true, inferenceTimeoutMs: 5000 },
      async (_config, device) => {
        if (device === "gpu") {
          throw new Error("accelerator not available");
        }
        return { generate: async (input: string) => `cpu:${input}` };
      },
    );

    const response = await provider.infer({
      contractVersion: 1,
      requestId: "req-1",
      input: "hello",
      expectedOutputFormat: "text",
    });

    expect(response.status).toBe("success");
    const readiness = provider.getReadiness();
    expect(readiness.acceleratorRequested).toBe(true);
    expect(readiness.acceleratorActive).toBe(false);
    expect(readiness.reason).toBeTruthy();
  });

  it("uses the accelerator when it initializes successfully", async () => {
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: true, inferenceTimeoutMs: 5000 },
      async () => ({ generate: async (input: string) => `gpu:${input}` }),
    );

    await provider.infer({
      contractVersion: 1,
      requestId: "req-2",
      input: "hello",
      expectedOutputFormat: "text",
    });

    const readiness = provider.getReadiness();
    expect(readiness.acceleratorRequested).toBe(true);
    expect(readiness.acceleratorActive).toBe(true);
  });
});
