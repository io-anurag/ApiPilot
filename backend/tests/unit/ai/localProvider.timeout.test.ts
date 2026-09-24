import { describe, expect, it, vi } from "vitest";
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

  it("calls hooks.onStarted once, after the engine is ready and before generation", async () => {
    const events: string[] = [];
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      async () => {
        events.push("engine-loaded");
        return {
          generate: async () => {
            events.push("generate");
            return "done";
          },
        };
      },
    );

    const response = await provider.infer(TEXT_INFERENCE_REQUEST, {
      onStarted: () => events.push("started"),
    });

    expect(response.status).toBe("success");
    expect(events).toEqual(["engine-loaded", "started", "generate"]);
  });

  it("passes the request's systemPrompt through to the engine", async () => {
    let received: { systemPrompt?: string } | undefined;
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      async () => ({
        generate: async (_input: string, options: { systemPrompt?: string }) => {
          received = options;
          return "{}";
        },
      }),
    );

    await provider.infer({ ...TEXT_INFERENCE_REQUEST, systemPrompt: "custom" });

    expect(received?.systemPrompt).toBe("custom");
  });

  it("never calls onStarted for empty input, a load failure, or a NOT_READY provider", async () => {
    const onStarted = vi.fn();
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      async () => {
        throw new Error("load failed");
      },
    );

    const empty = await provider.infer({ ...TEXT_INFERENCE_REQUEST, input: "  " }, { onStarted });
    const loadFailed = await provider.infer(TEXT_INFERENCE_REQUEST, { onStarted });
    const notReady = await provider.infer(TEXT_INFERENCE_REQUEST, { onStarted });

    expect(empty.errorCategory).toBe("INVALID_REQUEST");
    expect(loadFailed.errorCategory).toBe("LOAD_FAILED");
    expect(notReady.errorCategory).toBe("NOT_READY");
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("fires a queued request's onStarted only after the request ahead of it settles", async () => {
    let releaseFirst: (() => void) | undefined;
    let calls = 0;
    const provider = new LocalProvider(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      async () => ({
        generate: async () => {
          calls += 1;
          if (calls === 1) {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
          }
          return "done";
        },
      }),
    );
    const secondStarted = vi.fn();

    const first = provider.infer(TEXT_INFERENCE_REQUEST);
    const second = provider.infer(TEXT_INFERENCE_REQUEST, { onStarted: secondStarted });
    await vi.waitFor(() => expect(releaseFirst).toBeDefined());

    expect(secondStarted).not.toHaveBeenCalled();
    releaseFirst?.();
    await first;
    await second;
    expect(secondStarted).toHaveBeenCalledTimes(1);
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
