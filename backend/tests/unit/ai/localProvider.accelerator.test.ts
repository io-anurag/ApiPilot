import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferenceRequest } from "@apipilot/shared-domain";
import { ACCELERATOR_CANARY_INPUT } from "../../../src/ai/acceleratorVerification";
import {
  acceleratorLabelForPlatform,
  LocalProvider,
  type TextGenerationEngine,
} from "../../../src/ai/localProvider";

const VALID_CANARY_REPLY = '{"candidates":[]}';

const baseConfig = {
  modelId: "fake-model",
  cacheDir: "/tmp/fake-cache",
  useAccelerator: true,
  inferenceTimeoutMs: 5000,
};

function textRequest(requestId: string, input = "hello"): InferenceRequest {
  return { contractVersion: 1, requestId, input, expectedOutputFormat: "text" };
}

/**
 * A fake engine that answers the accelerator canary with `canary(...)` and any other input with
 * `<label>:<input>`, recording every input it receives and whether it was disposed.
 */
function fakeEngine(
  label: string,
  canary: (input: string) => Promise<string> | string = () => VALID_CANARY_REPLY,
  countTokens?: (text: string) => number,
) {
  const calls: string[] = [];
  const dispose = vi.fn(async () => undefined);
  const engine: TextGenerationEngine = {
    generate: async (input) => {
      calls.push(input);
      if (input === ACCELERATOR_CANARY_INPUT) return canary(input);
      return `${label}:${input}`;
    },
    dispose,
    ...(countTokens ? { countTokens } : {}),
  };
  return { engine, calls, dispose };
}

/** A canary reply that arrives after a short real delay, so the measured duration is non-zero. */
const slowValidReply = () =>
  new Promise<string>((resolve) => setTimeout(() => resolve(VALID_CANARY_REPLY), 30));

afterEach(() => {
  vi.restoreAllMocks();
});

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
      async () => ({
        // The accelerator is only kept if it answers the post-load verification
        // (specs/055-accelerator-canary-check), so the fake must answer it.
        generate: async (input: string) =>
          input === ACCELERATOR_CANARY_INPUT ? VALID_CANARY_REPLY : `gpu:${input}`,
      }),
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

describe("LocalProvider accelerator verification (specs/055-accelerator-canary-check)", () => {
  it("falls back to CPU, with a visible reason, when the accelerator's reply is unusable", async () => {
    const gpu = fakeEngine("gpu", () => "Trader please twots, dez");
    const cpu = fakeEngine("cpu");
    const provider = new LocalProvider(baseConfig, async (_config, device) =>
      device === "gpu" ? gpu.engine : cpu.engine,
    );

    const response = await provider.infer(textRequest("req-3"));

    expect(response).toMatchObject({ status: "success", content: "cpu:hello" });
    const readiness = provider.getReadiness();
    expect(readiness).toMatchObject({
      state: "ready",
      acceleratorRequested: true,
      acceleratorActive: false,
    });
    expect(readiness.reason).toContain("failed verification (unusable-reply)");
    // The accelerated engine saw the canary and nothing else, and was released.
    expect(gpu.calls).toEqual([ACCELERATOR_CANARY_INPUT]);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
  });

  it("treats a verification that times out as a failure, and waits for the abandoned run before loading CPU", async () => {
    const order: string[] = [];
    const gpu = fakeEngine(
      "gpu",
      () =>
        new Promise<string>((resolve) =>
          setTimeout(() => {
            order.push("canary-settled");
            resolve(VALID_CANARY_REPLY);
          }, 60),
        ),
    );
    const cpu = fakeEngine("cpu");
    const provider = new LocalProvider({ ...baseConfig, inferenceTimeoutMs: 20 }, async (_config, device) => {
      if (device === "gpu") return gpu.engine;
      order.push("cpu-load");
      return cpu.engine;
    });

    const response = await provider.infer(textRequest("req-4"));

    expect(response).toMatchObject({ status: "success", content: "cpu:hello" });
    expect(provider.getReadiness().reason).toContain("(timeout)");
    expect(provider.getReadiness().acceleratorActive).toBe(false);
    // The orphaned generation cannot be aborted, so the CPU engine must not load until it settles.
    expect(order).toEqual(["canary-settled", "cpu-load"]);
  });

  it("treats an engine error during verification as a failure without leaking the error text", async () => {
    const gpu = fakeEngine("gpu", () => {
      throw new Error("boom-secret-detail");
    });
    const cpu = fakeEngine("cpu");
    const provider = new LocalProvider(baseConfig, async (_config, device) =>
      device === "gpu" ? gpu.engine : cpu.engine,
    );

    const response = await provider.infer(textRequest("req-5"));

    expect(response).toMatchObject({ status: "success", content: "cpu:hello" });
    const reason = provider.getReadiness().reason ?? "";
    expect(reason).toContain("(inference-error)");
    expect(reason).not.toContain("boom-secret-detail");
  });

  it("ends unavailable, without a hidden retry, when CPU cannot load after a failed verification, and a retry repeats the check", async () => {
    let cpuFails = true;
    const loads: string[] = [];
    const accelerated: ReturnType<typeof fakeEngine>[] = [];
    const provider = new LocalProvider(baseConfig, async (_config, device) => {
      loads.push(device);
      if (device === "gpu") {
        const gpu = fakeEngine("gpu", () => "garbage");
        accelerated.push(gpu);
        return gpu.engine;
      }
      if (cpuFails) throw new Error("cpu load failed");
      return fakeEngine("cpu").engine;
    });

    const first = await provider.infer(textRequest("req-6"));
    expect(first).toMatchObject({ status: "error", errorCategory: "LOAD_FAILED" });
    const unavailable = provider.getReadiness();
    expect(unavailable.state).toBe("unavailable");
    expect(unavailable.reason).toBeTruthy();
    // An unavailable state carries no verification result (data-model.md).
    expect(unavailable.acceleratorVerification).toBeUndefined();
    expect(loads).toEqual(["gpu", "cpu"]);

    // No hidden retry: the next request is refused without touching any loader.
    const second = await provider.infer(textRequest("req-7"));
    expect(second).toMatchObject({ status: "error", errorCategory: "NOT_READY" });
    expect(loads).toEqual(["gpu", "cpu"]);

    // An explicit retry repeats the whole load, including the verification (FR-014).
    cpuFails = false;
    provider.retryLoad();
    const third = await provider.infer(textRequest("req-8"));
    expect(third).toMatchObject({ status: "success", content: "cpu:hello" });
    expect(loads).toEqual(["gpu", "cpu", "gpu", "cpu"]);
    expect(accelerated).toHaveLength(2);
    expect(accelerated[1].calls).toEqual([ACCELERATOR_CANARY_INPUT]);
  });

  it("runs no verification, and loads only the CPU engine, when the accelerator is not enabled", async () => {
    const cpu = fakeEngine("cpu");
    const loader = vi.fn(async (_config: unknown, _device: string) => cpu.engine);
    const provider = new LocalProvider({ ...baseConfig, useAccelerator: false }, loader);

    await provider.infer(textRequest("req-9"));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0][1]).toBe("cpu");
    expect(cpu.calls).toEqual(["hello"]);
    expect(provider.getReadiness().acceleratorVerification).toBeUndefined();
  });

  it("keeps requests queued, in arrival order, until the device decision is made", async () => {
    let releaseCanary: (reply: string) => void = () => undefined;
    const gpu = fakeEngine(
      "gpu",
      () =>
        new Promise<string>((resolve) => {
          releaseCanary = resolve;
        }),
    );
    const cpu = fakeEngine("cpu");
    const provider = new LocalProvider(baseConfig, async (_config, device) =>
      device === "gpu" ? gpu.engine : cpu.engine,
    );

    const first = provider.infer(textRequest("one", "first"));
    const second = provider.infer(textRequest("two", "second"));

    await vi.waitFor(() => expect(gpu.calls).toEqual([ACCELERATOR_CANARY_INPUT]));
    // Still deciding: nothing has reached either device except the canary.
    expect(provider.getReadiness().state).toBe("loading");
    expect(cpu.calls).toEqual([]);

    releaseCanary("garbage");
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.content)).toEqual(["cpu:first", "cpu:second"]);
    expect(cpu.calls).toEqual(["first", "second"]);
    // The rejected accelerator never answered a real request.
    expect(gpu.calls).toEqual([ACCELERATOR_CANARY_INPUT]);
  });

  describe("device, label and throughput reporting", () => {
    it("reports the accelerator, its label and a positive throughput after a verified load", async () => {
      const gpu = fakeEngine("gpu", slowValidReply, () => 4);
      const provider = new LocalProvider(baseConfig, async () => gpu.engine);

      await provider.infer(textRequest("req-11"));

      const readiness = provider.getReadiness();
      expect(readiness.inferenceDevice).toBe("accelerator");
      expect(readiness.acceleratorLabel).toBe(acceleratorLabelForPlatform(process.platform));
      expect(readiness.acceleratorLabel).toBeTruthy();
      expect(readiness.acceleratorVerification).toMatchObject({ outcome: "passed", canaryVersion: 1 });
      const rate = readiness.acceleratorVerification?.tokensPerSecond;
      expect(rate).toBeGreaterThan(0);
      expect(Number.isFinite(rate)).toBe(true);
      expect(readiness.acceleratorVerification?.failureCategory).toBeUndefined();
    });

    it("omits the throughput, rather than estimating it, when the engine cannot count tokens", async () => {
      const gpu = fakeEngine("gpu", slowValidReply);
      const provider = new LocalProvider(baseConfig, async () => gpu.engine);

      await provider.infer(textRequest("req-12"));

      const verification = provider.getReadiness().acceleratorVerification;
      expect(verification?.outcome).toBe("passed");
      expect(verification).not.toHaveProperty("tokensPerSecond");
    });

    it("reports CPU, no label and no throughput after a failed verification", async () => {
      const gpu = fakeEngine("gpu", () => "garbage", () => 4);
      const cpu = fakeEngine("cpu");
      const provider = new LocalProvider(baseConfig, async (_config, device) =>
        device === "gpu" ? gpu.engine : cpu.engine,
      );

      await provider.infer(textRequest("req-13"));

      const readiness = provider.getReadiness();
      expect(readiness.inferenceDevice).toBe("cpu");
      expect(readiness.acceleratorLabel).toBeUndefined();
      expect(readiness.acceleratorVerification?.outcome).toBe("failed");
      expect(readiness.acceleratorVerification).not.toHaveProperty("tokensPerSecond");
    });

    it("reports CPU, with no verification, after an accelerator load failure", async () => {
      const cpu = fakeEngine("cpu");
      const provider = new LocalProvider(baseConfig, async (_config, device) => {
        if (device === "gpu") throw new Error("accelerator not available");
        return cpu.engine;
      });

      await provider.infer(textRequest("req-14"));

      const readiness = provider.getReadiness();
      expect(readiness.inferenceDevice).toBe("cpu");
      expect(readiness.acceleratorVerification).toBeUndefined();
    });

    it("reports CPU, with no accelerator fields, on a plain CPU load", async () => {
      const cpu = fakeEngine("cpu");
      const provider = new LocalProvider({ ...baseConfig, useAccelerator: false }, async () => cpu.engine);

      await provider.infer(textRequest("req-15"));

      const readiness = provider.getReadiness();
      expect(readiness.inferenceDevice).toBe("cpu");
      expect(readiness.acceleratorLabel).toBeUndefined();
      expect(readiness.acceleratorVerification).toBeUndefined();
    });

    it("labels only the measured platform and never reports an unverified vendor name", () => {
      expect(acceleratorLabelForPlatform("win32")).toBe("DirectML");
      for (const platform of ["linux", "darwin", "freebsd", "aix"] as const) {
        expect(acceleratorLabelForPlatform(platform)).toBe("Accelerator");
      }
    });
  });

  describe("constitution XX: nothing sensitive reaches the logs", () => {
    function captureLogs(): string[] {
      const lines: string[] = [];
      for (const method of ["log", "info", "warn", "error"] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(" "));
        });
      }
      return lines;
    }

    it("logs one verification record with only outcome, category, duration and version", async () => {
      const logs = captureLogs();
      const REPLY_SENTINEL = "SECRET-CANARY-REPLY-5d2c";
      const gpu = fakeEngine("gpu", () => REPLY_SENTINEL);
      const cpu = fakeEngine("cpu");
      const provider = new LocalProvider(baseConfig, async (_config, device) =>
        device === "gpu" ? gpu.engine : cpu.engine,
      );

      await provider.infer(textRequest("req-10"));

      const records = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
      const verification = records.filter((record) => record.event === "accelerator_verification");
      expect(verification).toHaveLength(1);
      expect(verification[0]).toMatchObject({
        outcome: "failed",
        failureCategory: "unusable-reply",
        canaryVersion: 1,
        modelId: "fake-model",
      });
      expect(typeof verification[0].durationMs).toBe("number");

      const everything = logs.join("\n");
      expect(everything).not.toContain(REPLY_SENTINEL);
      expect(everything).not.toContain("Reply with exactly");
    });
  });
});
