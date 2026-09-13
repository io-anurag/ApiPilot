import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    level: "warn",
    component: "executionClient",
    event: "fetch_failed",
    timestamp: "2026-09-14T10:15:00.000Z",
    fields: { operation: "startExecution", errorCategory: "network_error", statusCode: 502 },
    ...overrides,
  };
}

describe("POST /api/client-logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a well-formed entry, returns 202, and persists it under the frontend-client component (FR-006)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await request(createApp()).post("/api/client-logs").send(validEntry());

    expect(response.status).toBe(202);
    expect(response.body).toEqual({});
    const parsedCalls = warnSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const entry = parsedCalls.find((line) => line.component === "frontend-client");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      level: "warn",
      component: "frontend-client",
      event: "fetch_failed",
      frontendComponent: "executionClient",
      clientTimestamp: "2026-09-14T10:15:00.000Z",
      operation: "startExecution",
      errorCategory: "network_error",
      statusCode: 502,
    });
  });

  it.each(["level", "component", "event", "timestamp"])(
    "rejects a request missing %s with 400 invalid_client_log_entry (FR-007)",
    async (field) => {
      const entry = validEntry({ [field]: undefined });

      const response = await request(createApp()).post("/api/client-logs").send(entry);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid_client_log_entry");
    },
  );

  it("rejects a request with an invalid level with 400 invalid_client_log_entry (FR-007)", async () => {
    const response = await request(createApp())
      .post("/api/client-logs")
      .send(validEntry({ level: "debug" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_client_log_entry");
  });

  it("drops a non-primitive field but still persists the rest of the entry (FR-007)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await request(createApp())
      .post("/api/client-logs")
      .send(validEntry({ fields: { operation: "startExecution", nested: { a: 1 } } }));

    expect(response.status).toBe(202);
    const parsedCalls = warnSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const entry = parsedCalls.find((line) => line.component === "frontend-client");
    expect(entry.operation).toBe("startExecution");
    expect(entry).not.toHaveProperty("nested");
  });

  it("drops a credential-shaped field name even when its value is an ordinary string (FR-004, SC-008)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await request(createApp())
      .post("/api/client-logs")
      .send(validEntry({ fields: { operation: "login", token: "abc123realsecret" } }));

    expect(response.status).toBe(202);
    const parsedCalls = warnSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const entry = parsedCalls.find((line) => line.component === "frontend-client");
    expect(entry.operation).toBe("login");
    expect(entry).not.toHaveProperty("token");
  });

  it("rejects a request exceeding the dedicated ~8KB size limit with 413, independent of the 10MB spec-upload limit (FR-013, SC-006)", async () => {
    const oversized = "a".repeat(9000);

    const response = await request(createApp())
      .post("/api/client-logs")
      .send(validEntry({ fields: { operation: oversized } }));

    expect(response.status).toBe(413);
    expect(response.body.error).toBe("payload_too_large");
    // Regression pin: the message must name the ~8KB limit that actually applied to this route,
    // not the unrelated 10MB global spec-upload limit (MAX_UPLOAD_BYTES).
    expect(response.body.message).toContain("8192 bytes");
    expect(response.body.message).not.toContain("10485760");
  });

  it("responds 405 for non-POST methods", async () => {
    const response = await request(createApp()).get("/api/client-logs");

    expect(response.status).toBe(405);
  });
});
