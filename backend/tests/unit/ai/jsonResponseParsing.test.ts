import { describe, expect, it } from "vitest";
import { extractJsonObjects, stripCodeFence } from "../../../src/ai/jsonResponseParsing";

describe("jsonResponseParsing", () => {
  it("strips a ```json fence and leaves the document unchanged", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("extracts JSON objects surrounded by prose", () => {
    expect(extractJsonObjects('Here you go: {"a":1} hope that helps')).toEqual(['{"a":1}']);
  });

  it("keeps braces that appear inside strings within one object", () => {
    const content = 'prefix {"text":"a } and { b","n":{"x":1}} suffix';
    expect(extractJsonObjects(content)[0]).toBe('{"text":"a } and { b","n":{"x":1}}');
  });
});
