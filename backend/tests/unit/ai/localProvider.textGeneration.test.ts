import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerator = vi.fn();
const mockTokenizer = {
  model_max_length: 4096,
  encode: (text: string) => Array.from({ length: Math.ceil(text.length / 4) }),
  chat_template: undefined as string | undefined,
  apply_chat_template: vi.fn(
    (
      messages: { role: string; content: string }[],
      options: { tokenize: false; add_generation_prompt: boolean },
    ) => JSON.stringify({ messages, options }),
  ),
};

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(async () => Object.assign(mockGenerator, { tokenizer: mockTokenizer })),
  env: {},
}));

const { loadTransformersEngine } = await import("../../../src/ai/localProvider");

describe("loadTransformersEngine", () => {
  beforeEach(() => {
    mockTokenizer.chat_template = undefined;
    mockTokenizer.apply_chat_template.mockClear();
    mockGenerator.mockReset();
  });

  it("passes a chat-templated system and user message when the tokenizer declares a template", async () => {
    mockTokenizer.chat_template = "test-template";
    mockGenerator.mockResolvedValue([
      { generated_text: '{"responseVersion":1,"candidates":[]}' },
    ]);

    const engine = await loadTransformersEngine(
      {
        modelId: "fake-model",
        cacheDir: "/tmp/fake-cache",
        useAccelerator: false,
        inferenceTimeoutMs: 5000,
      },
      "cpu",
    );
    await engine.generate("some prompt", {
      maxNewTokens: 64,
      expectedOutputFormat: "json",
    });

    expect(mockTokenizer.apply_chat_template).toHaveBeenCalledWith(
      [
        { role: "system", content: expect.stringContaining("valid JSON") },
        { role: "user", content: "some prompt" },
      ],
      { tokenize: false, add_generation_prompt: true },
    );
    expect(mockGenerator).toHaveBeenCalledWith(
      expect.stringContaining('"role":"user"'),
      expect.objectContaining({ return_full_text: false }),
    );
  });

  it("selects the text system message for text requests and the JSON system message for JSON requests", async () => {
    mockTokenizer.chat_template = "test-template";
    mockGenerator.mockResolvedValue([{ generated_text: "completion" }]);

    const engine = await loadTransformersEngine(
      {
        modelId: "fake-model",
        cacheDir: "/tmp/fake-cache",
        useAccelerator: false,
        inferenceTimeoutMs: 5000,
      },
      "cpu",
    );

    await engine.generate("text prompt", { expectedOutputFormat: "text" });
    await engine.generate("json prompt", { expectedOutputFormat: "json" });

    const calls = mockTokenizer.apply_chat_template.mock.calls;
    expect(calls[0][0]).toEqual([
      { role: "system", content: expect.stringContaining("Answer concisely") },
      { role: "user", content: "text prompt" },
    ]);
    expect(calls[1][0]).toEqual([
      { role: "system", content: expect.stringContaining("valid JSON") },
      { role: "user", content: "json prompt" },
    ]);
  });

  it("passes return_full_text: false, so a plain-string (non-chat) prompt's generated_text is only the completion, not prompt+completion concatenated", async () => {
    mockTokenizer.chat_template = undefined;
    mockGenerator.mockResolvedValue([
      { generated_text: '{"responseVersion":1,"candidates":[]}' },
    ]);

    const engine = await loadTransformersEngine(
      {
        modelId: "fake-model",
        cacheDir: "/tmp/fake-cache",
        useAccelerator: false,
        inferenceTimeoutMs: 5000,
      },
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
