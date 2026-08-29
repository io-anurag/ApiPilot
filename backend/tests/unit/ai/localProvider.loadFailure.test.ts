import { describe, expect, it } from "vitest";
import { LocalProvider } from "../../../src/ai/localProvider";

describe("LocalProvider load-failure handling (FR-019)", () => {
  it("reports LOAD_FAILED and transitions to unavailable when the engine fails to load", async () => {
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      async () => {
        throw new Error("cache directory is corrupted");
      },
    );

    const response = await provider.infer({
      contractVersion: 1,
      requestId: "req-1",
      input: "hello",
      expectedOutputFormat: "text",
    });

    expect(response.status).toBe("error");
    expect(response.errorCategory).toBe("LOAD_FAILED");
    expect(provider.getReadiness().state).toBe("unavailable");
  });

  it("does not automatically retry loading on a subsequent request; requires explicit retryLoad()", async () => {
    let loadAttempts = 0;
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      async () => {
        loadAttempts += 1;
        if (loadAttempts === 1) {
          throw new Error("cache directory is corrupted");
        }
        return { generate: async (input: string) => `ok:${input}` };
      },
    );

    const first = await provider.infer({
      contractVersion: 1,
      requestId: "req-1",
      input: "hello",
      expectedOutputFormat: "text",
    });
    expect(first.errorCategory).toBe("LOAD_FAILED");

    const second = await provider.infer({
      contractVersion: 1,
      requestId: "req-2",
      input: "hello",
      expectedOutputFormat: "text",
    });
    expect(second.errorCategory).toBe("NOT_READY");
    expect(loadAttempts).toBe(1);

    provider.retryLoad();

    const third = await provider.infer({
      contractVersion: 1,
      requestId: "req-3",
      input: "hello",
      expectedOutputFormat: "text",
    });
    expect(third.status).toBe("success");
    expect(loadAttempts).toBe(2);
  });
});
