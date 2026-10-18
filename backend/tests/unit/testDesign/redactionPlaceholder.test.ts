import { describe, expect, it } from "vitest";
import {
  containsRedactionPlaceholder,
  credentialKindForField,
  credentialKindForHeader,
  formatRedactionPlaceholder,
  isBearerTokenValue,
  isSensitiveFieldName,
  isSensitiveHeaderName,
  redactionPlaceholderKind,
} from "../../../src/testDesign/sensitiveValueDetection";

describe("redactionPlaceholderKind (specs/056 research R24)", () => {
  it.each([
    ["[redacted:token]", "token"],
    ["[redacted:apiKey]", "apiKey"],
    ["[redacted:password]", "password"],
    ["[redacted:cookie]", "token"],
    ["[redacted:session]", "token"],
  ])("maps %s to the %s variable", (placeholder, kind) => {
    expect(redactionPlaceholderKind(placeholder)).toBe(kind);
  });

  it.each([
    "[redacted]",
    "[redacted:other]",
    "[REDACTED:token]",
    " [redacted:token]",
    "[redacted:token] ",
    "prefix [redacted:token]",
    "[redacted:token]suffix",
    "[redacted:token][redacted:token]",
    "",
    "Bearer abc",
  ])("rejects the look-alike %j", (value) => {
    expect(redactionPlaceholderKind(value)).toBeUndefined();
  });

  it("rejects non-string values", () => {
    for (const value of [undefined, null, 1, true, {}, []]) expect(redactionPlaceholderKind(value)).toBeUndefined();
  });

  it("writes exactly what it reads", () => {
    for (const kind of ["token", "apiKey", "password", "cookie", "session"] as const) {
      expect(redactionPlaceholderKind(formatRedactionPlaceholder(kind))).toBeDefined();
    }
  });

  it("detects any placeholder text inside a larger string", () => {
    expect(containsRedactionPlaceholder('{"a":"[redacted:token]"}')).toBe(true);
    expect(containsRedactionPlaceholder("nothing here")).toBe(false);
  });
});

describe("the existing credential predicates are unchanged (specs/056 FR-034)", () => {
  it("keeps the header results", () => {
    expect(isSensitiveHeaderName("Authorization")).toBe(true);
    expect(isSensitiveHeaderName("X-Custom")).toBe(false);
    expect(credentialKindForHeader("X-Api-Key", "v")).toBe("apiKey");
    expect(credentialKindForHeader("Cookie", "v")).toBe("token");
    expect(credentialKindForHeader("Authorization", "Bearer x")).toBe("token");
    expect(credentialKindForHeader("X-Other", "Bearer x")).toBe("token");
    expect(credentialKindForHeader("X-Other", "plain")).toBeUndefined();
    expect(credentialKindForHeader("X-Other", "[redacted:token]")).toBeUndefined();
  });

  it("keeps the field results, and does not treat a placeholder as a credential by itself", () => {
    expect(credentialKindForField("password", "x")).toBe("password");
    expect(credentialKindForField("api_key", "x")).toBe("apiKey");
    expect(credentialKindForField("access_token", "x")).toBe("token");
    expect(credentialKindForField("name", "Bearer abc")).toBe("token");
    expect(credentialKindForField("name", "x")).toBeUndefined();
    expect(credentialKindForField("name", "[redacted:token]")).toBeUndefined();
    expect(isSensitiveFieldName("tokenizer")).toBe(true);
    expect(isSensitiveFieldName("monkey")).toBe(false);
    expect(isBearerTokenValue("Bearer x")).toBe(true);
    expect(isBearerTokenValue("[redacted:token]")).toBe(false);
  });
});
