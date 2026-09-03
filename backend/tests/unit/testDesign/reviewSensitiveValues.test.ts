import { describe, expect, it } from "vitest";
import { redactSensitiveRequestValues } from "../../../src/testDesign/reviewSensitiveValues";

describe("redactSensitiveRequestValues", () => {
  it("redacts Authorization and other credential-like headers", () => {
    const redacted = redactSensitiveRequestValues({
      pathParameters: {},
      queryParameters: {},
      headers: { Authorization: "Bearer sk-live-abc123", "X-Api-Key": "abc" },
    });
    expect(redacted.headers.Authorization).toBe("[redacted]");
    expect(redacted.headers["X-Api-Key"]).toBe("[redacted]");
  });

  it("preserves non-sensitive headers unchanged", () => {
    const redacted = redactSensitiveRequestValues({
      pathParameters: {},
      queryParameters: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(redacted.headers["Content-Type"]).toBe("application/json");
  });

  it("redacts sensitive body fields by name while preserving other fields", () => {
    const redacted = redactSensitiveRequestValues({
      pathParameters: {},
      queryParameters: {},
      headers: {},
      body: { name: "Widget", password: "hunter2", apiKey: "sk-123" },
    });
    expect(redacted.body).toEqual({
      name: "Widget",
      password: "[redacted]",
      apiKey: "[redacted]",
    });
  });

  it("redacts bearer-token-shaped string values regardless of field name", () => {
    const redacted = redactSensitiveRequestValues({
      pathParameters: {},
      queryParameters: {},
      headers: {},
      body: { note: "Bearer sk-live-abc123secret" },
    });
    expect(redacted.body).toEqual({ note: "[redacted]" });
  });

  it("redacts sensitive fields nested inside objects and arrays", () => {
    const redacted = redactSensitiveRequestValues({
      pathParameters: {},
      queryParameters: {},
      headers: {},
      body: { user: { name: "A", credential: "x" }, items: [{ token: "y" }] },
    });
    expect(redacted.body).toEqual({
      user: { name: "A", credential: "[redacted]" },
      items: [{ token: "[redacted]" }],
    });
  });

  it("preserves non-sensitive test intent, including numeric and null values", () => {
    const redacted = redactSensitiveRequestValues({
      pathParameters: { id: "123" },
      queryParameters: { limit: 5 },
      headers: {},
      body: { quantity: 0, note: null },
    });
    expect(redacted.pathParameters).toEqual({ id: "123" });
    expect(redacted.queryParameters).toEqual({ limit: 5 });
    expect(redacted.body).toEqual({ quantity: 0, note: null });
  });
});
