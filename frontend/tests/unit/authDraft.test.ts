import { describe, expect, it } from "vitest";
import { initialAuthDraft, toRequestAuthEdit } from "../../src/utils/authDraft";

describe("authDraft (specs/028 FR-002c)", () => {
  it("starts as inherit when the auth comes from a folder or the collection, or none applies", () => {
    expect(initialAuthDraft(undefined).type).toBe("inherit");
    const inherited = initialAuthDraft({
      type: "bearer",
      source: { kind: "folder", folderId: "f", folderName: "F" },
      fields: [{ key: "token", value: "{{t}}", hiddenLiteral: false }],
    });
    expect(toRequestAuthEdit(inherited)).toEqual({ type: "inherit" });
  });

  it("keeps a hidden literal left blank, only for the stored type", () => {
    const draft = initialAuthDraft({
      type: "basic",
      source: { kind: "request" },
      fields: [
        { key: "username", value: "{{user}}", hiddenLiteral: false },
        { key: "password", value: "", hiddenLiteral: true },
      ],
    });
    expect(toRequestAuthEdit(draft)).toEqual({ type: "basic", username: "{{user}}", password: { kind: "keep" } });
    expect(toRequestAuthEdit({ ...draft, fields: { ...draft.fields, password: "new" } })).toEqual({
      type: "basic",
      username: "{{user}}",
      password: { kind: "set", value: "new" },
    });
    expect(toRequestAuthEdit({ ...draft, type: "bearer" })).toEqual({ type: "bearer", token: { kind: "set", value: "" } });
  });

  it("reads an API key's location, and leaves an unsupported type alone", () => {
    const apikey = initialAuthDraft({
      type: "apikey",
      source: { kind: "request" },
      fields: [
        { key: "key", value: "k", hiddenLiteral: false },
        { key: "value", value: "{{v}}", hiddenLiteral: false },
        { key: "in", value: "query", hiddenLiteral: false },
      ],
    });
    expect(toRequestAuthEdit(apikey)).toEqual({ type: "apikey", key: "k", value: { kind: "set", value: "{{v}}" }, in: "query" });
    expect(toRequestAuthEdit(initialAuthDraft({ type: "oauth2", source: { kind: "request" }, fields: [] }))).toBeUndefined();
  });
});
