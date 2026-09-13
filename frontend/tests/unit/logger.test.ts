import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("emits one structured object per call, tagged with the logger's component and the given event/fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    createLogger("test-component").info("thing_happened", { operation: "load", statusCode: 200 });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      component: "test-component",
      event: "thing_happened",
      operation: "load",
      statusCode: 200,
    });
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
  });

  it("routes warn/error to console.warn/console.error respectively, not console.log", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const logger = createLogger("test-component");
    logger.warn("degraded");
    logger.error("failed");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("uses an injectable clock to produce a deterministic timestamp (FR-011)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");

    createLogger("test-component", { now: () => fixedNow }).info("thing_happened");

    const entry = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("drops a field whose value is an object, array, or function rather than serializing it (FR-003)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    createLogger("test-component").info("thing_happened", {
      // @ts-expect-error -- deliberately passing a non-primitive value to prove runtime filtering
      nested: { a: 1 },
      // @ts-expect-error -- deliberately passing a non-primitive value to prove runtime filtering
      list: [1, 2, 3],
      // @ts-expect-error -- deliberately passing a non-primitive value to prove runtime filtering
      fn: () => undefined,
      operation: "load",
    });

    const entry = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty("nested");
    expect(entry).not.toHaveProperty("list");
    expect(entry).not.toHaveProperty("fn");
    expect(entry.operation).toBe("load");
  });

  it("forwards warn/error entries to the backend, but never info (FR-005)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const logger = createLogger("test-component");
    logger.info("info_event");
    logger.warn("warn_event", { operation: "load" });
    logger.error("error_event", { operation: "load" });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/client-logs");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      level: "warn",
      component: "test-component",
      event: "warn_event",
      fields: { operation: "load" },
    });
  });

  it("never throws or blocks when the forwarding fetch rejects, and warns locally at most once (FR-008)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    expect(() => createLogger("test-component").error("failed")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws or blocks when the forwarding response is non-2xx (FR-008)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));

    expect(() => createLogger("test-component").error("failed")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("drops a field whose name is credential-shaped even when its value is an ordinary string (FR-004, SC-008)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    createLogger("test-component").info("login_attempt", {
      token: "abc123realsecret",
      apiKey: "key-value",
      Authorization: "Bearer abc",
      userPassword: "hunter2",
      operation: "login",
    });

    const entry = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty("token");
    expect(entry).not.toHaveProperty("apiKey");
    expect(entry).not.toHaveProperty("Authorization");
    expect(entry).not.toHaveProperty("userPassword");
    expect(entry.operation).toBe("login");
  });
});
