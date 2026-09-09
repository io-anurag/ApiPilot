import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig } from "@apipilot/shared-domain";
import {
  LocalProvider,
  resolveModelCapacity,
  type TextGenerationEngine,
} from "../../../src/ai/localProvider";

const mockGenerator = vi.fn();
const mockTokenizer = {
  model_max_length: 100,
  encode: (text: string) => Array.from({ length: text.length }),
};

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(async () =>
    Object.assign(mockGenerator, {
      tokenizer: mockTokenizer,
      model: { config: { max_position_embeddings: 100 } },
    }),
  ),
  env: {},
}));

const modelConfig: ModelConfig = {
  modelId: "test-model",
  cacheDir: "/tmp/test-cache",
  useAccelerator: false,
  inferenceTimeoutMs: 5000,
};

describe("resolveModelCapacity", () => {
  it("uses the smaller model and tokenizer limit", () => {
    expect(resolveModelCapacity(32_768, 131_072, 2048)).toEqual({
      contextWindowTokens: 32_768,
      source: "model-config",
      isFallback: false,
    });
  });

  it.each([
    [undefined, 4096],
    [Number.NaN, 4096],
    [Number.POSITIVE_INFINITY, 4096],
    [4096, undefined],
    [4096, Number.NaN],
    [4096, Number.POSITIVE_INFINITY],
  ])(
    "discards an unusable limit and keeps the usable limit (%s, %s)",
    (model, tokenizer) => {
      expect(resolveModelCapacity(model, tokenizer, 2048).contextWindowTokens).toBe(4096);
    },
  );

  it("uses the conservative floor when neither limit is usable", () => {
    expect(resolveModelCapacity(undefined, Number.NaN, 2048)).toEqual({
      contextWindowTokens: 2048,
      source: "conservative-floor",
      isFallback: true,
    });
  });
});

describe("LocalProvider capacity planning", () => {
  beforeEach(() => {
    mockGenerator.mockReset();
  });

  it("derives its input budget from the engine capacity", async () => {
    const engine: TextGenerationEngine = {
      capacity: {
        contextWindowTokens: 100,
        source: "model-config",
        isFallback: false,
      },
      generate: async () => "{}",
    };
    const provider = new LocalProvider(modelConfig, async () => engine);

    await expect(provider.getInputBudget(20)).resolves.toBe((100 - 20 - 64) * 3);
  });

  it("uses the same resolved capacity for the oversized-input guard", async () => {
    const { loadTransformersEngine } = await import("../../../src/ai/localProvider");
    const engine = await loadTransformersEngine(modelConfig, "cpu");

    await expect(
      engine.generate("x".repeat(40), { maxNewTokens: 1 }),
    ).rejects.toMatchObject({
      category: "INVALID_REQUEST",
    });
    expect(mockGenerator).not.toHaveBeenCalled();
  });
});
