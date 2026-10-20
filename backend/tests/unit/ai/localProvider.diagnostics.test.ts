import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalProvider, type TextGenerationEngine } from "../../../src/ai/localProvider";
import { TEXT_INFERENCE_REQUEST } from "../../fixtures/ai/sampleInferenceRequests";

const config = {
  modelId: "fake-model",
  cacheDir: "/tmp/fake-cache",
  useAccelerator: false,
  inferenceTimeoutMs: 5000,
};

function captureLogs(): string[] {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  return lines;
}

function successRecord(lines: string[]): Record<string, unknown> {
  const record = lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((entry) => entry.event === "inference_success");
  if (!record) throw new Error("no inference_success event was logged");
  return record;
}

/** One token per character, so sizes in the log can be checked exactly. */
const countTokens = (text: string) => text.length;

afterEach(() => vi.restoreAllMocks());

describe("LocalProvider inference diagnostics", () => {
  it("logs prompt and output sizes and whether the reply stopped at its limit, without the text", async () => {
    const logs = captureLogs();
    const request = { ...TEXT_INFERENCE_REQUEST, input: "SECRET-PROMPT-TEXT", maxOutputTokens: 6 };
    const engine: TextGenerationEngine = { generate: async () => "SECRET", countTokens };
    const provider = new LocalProvider(config, async () => engine);

    await provider.infer(request);

    const record = successRecord(logs);
    expect(record).toMatchObject({
      promptChars: "SECRET-PROMPT-TEXT".length,
      outputChars: 6,
      promptTokens: "SECRET-PROMPT-TEXT".length,
      outputTokens: 6,
      maxOutputTokens: 6,
      outputReachedLimit: true,
    });
    expect(record.generationMs).toEqual(expect.any(Number));
    expect(logs.join("\n")).not.toContain("SECRET");
  });

  it("reports a reply that finished under its limit as not reaching it", async () => {
    const logs = captureLogs();
    const engine: TextGenerationEngine = { generate: async () => "ok", countTokens };
    const provider = new LocalProvider(config, async () => engine);

    await provider.infer({ ...TEXT_INFERENCE_REQUEST, maxOutputTokens: 256 });

    expect(successRecord(logs)).toMatchObject({ outputTokens: 2, outputReachedLimit: false });
  });

  it("omits token figures rather than guessing when the engine cannot count", async () => {
    const logs = captureLogs();
    const engine: TextGenerationEngine = { generate: async () => "ok" };
    const provider = new LocalProvider(config, async () => engine);

    const response = await provider.infer(TEXT_INFERENCE_REQUEST);

    expect(response.status).toBe("success");
    const record = successRecord(logs);
    expect(record).not.toHaveProperty("promptTokens");
    expect(record).not.toHaveProperty("outputTokens");
    expect(record).not.toHaveProperty("outputReachedLimit");
    expect(record.promptChars).toEqual(expect.any(Number));
  });

  it("does not fail a finished inference when the tokenizer throws", async () => {
    captureLogs();
    const engine: TextGenerationEngine = {
      generate: async () => "ok",
      countTokens: () => {
        throw new Error("tokenizer broke");
      },
    };
    const provider = new LocalProvider(config, async () => engine);

    const response = await provider.infer(TEXT_INFERENCE_REQUEST);

    expect(response.status).toBe("success");
    expect(response.content).toBe("ok");
  });
});
