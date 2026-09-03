import { describe, expect, it } from "vitest";
import {
  credentialKindForField,
  credentialKindForHeader,
  isBearerTokenValue,
  isSensitiveFieldName,
  isSensitiveHeaderName,
} from "../../../src/testDesign/sensitiveValueDetection";

describe("isSensitiveHeaderName", () => {
  it("detects credential-carrying headers regardless of case", () => {
    expect(isSensitiveHeaderName("Authorization")).toBe(true);
    expect(isSensitiveHeaderName("proxy-authorization")).toBe(true);
    expect(isSensitiveHeaderName("Cookie")).toBe(true);
    expect(isSensitiveHeaderName("X-Api-Key")).toBe(true);
  });

  it("leaves ordinary headers alone", () => {
    expect(isSensitiveHeaderName("Content-Type")).toBe(false);
    expect(isSensitiveHeaderName("X-Request-Id")).toBe(false);
  });
});

describe("isBearerTokenValue", () => {
  it("detects a bearer token value", () => {
    expect(isBearerTokenValue("Bearer abc.def.ghi")).toBe(true);
    expect(isBearerTokenValue("bearer abc")).toBe(true);
  });

  it("ignores non-string and ordinary values", () => {
    expect(isBearerTokenValue("bearerless")).toBe(false);
    expect(isBearerTokenValue(42)).toBe(false);
    expect(isBearerTokenValue(undefined)).toBe(false);
  });
});

describe("isSensitiveFieldName", () => {
  it("detects credential-named body fields", () => {
    expect(isSensitiveFieldName("password")).toBe(true);
    expect(isSensitiveFieldName("apiKey")).toBe(true);
    expect(isSensitiveFieldName("api_key")).toBe(true);
    expect(isSensitiveFieldName("clientSecret")).toBe(true);
    expect(isSensitiveFieldName("accessToken")).toBe(true);
  });

  it("leaves ordinary field names alone", () => {
    expect(isSensitiveFieldName("quantity")).toBe(false);
    expect(isSensitiveFieldName("username")).toBe(false);
  });
});

describe("credentialKindForHeader", () => {
  it("classifies which variable a detected header credential maps to", () => {
    expect(credentialKindForHeader("Authorization", "Bearer abc")).toBe("token");
    expect(credentialKindForHeader("X-Api-Key", "k-1")).toBe("apiKey");
    expect(credentialKindForHeader("Content-Type", "application/json")).toBeUndefined();
  });
});

describe("credentialKindForField", () => {
  it("classifies which variable a detected body credential maps to", () => {
    expect(credentialKindForField("password", "hunter2")).toBe("password");
    expect(credentialKindForField("apiKey", "k-1")).toBe("apiKey");
    expect(credentialKindForField("accessToken", "t-1")).toBe("token");
    expect(credentialKindForField("quantity", 2)).toBeUndefined();
  });
});