import { describe, expect, it, vi } from "vitest";

const mockGenerator = vi.fn();
const mockTokenizer = {
  model_max_length: 4096,
  encode: (text: string) => Array.from({ length: Math.ceil(text.length / 4) }),
};

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(async () => Object.assign(mockGenerator, { tokenizer: mockTokenizer })),
  env: {},
}));

const { loadTransformersEngine } = await import("../../../src/ai/localProvider");

describe("loadTransformersEngine", () => {
  it("passes return_full_text: false, so a plain-string (non-chat) prompt's generated_text is only the completion, not prompt+completion concatenated", async () => {
    mockGenerator.mockResolvedValue([
      { generated_text: '{"responseVersion":1,"candidates":[]}' },
    ]);

    const engine = await loadTransformersEngine(
      { modelId: "fake-model", cacheDir: "/tmp/fake-cache", useAccelerator: false, inferenceTimeoutMs: 5000 },
      "cpu",
    );
    const result = await engine.generate("some prompt", { maxNewTokens: 64 });

    expect(mockGenerator).toHaveBeenCalledWith(
      "some prompt",
      expect.objectContaining({ return_full_text: false }),
    );
    // Without return_full_text: false, this would instead be "some prompt" + the model's
    // continuation concatenated together — never valid JSON on its own.
    expect(result).toBe('{"responseVersion":1,"candidates":[]}');
  });
});
