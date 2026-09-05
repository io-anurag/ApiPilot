import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger";

describe("createLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits one JSON line per call, tagging it with the logger's component and the given event/fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    createLogger("test.component").info("thing_happened", { requestId: "req-1", durationMs: 42 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "info",
      component: "test.component",
      event: "thing_happened",
      requestId: "req-1",
      durationMs: 42,
    });
    expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
  });

  it("routes warn/error to console.warn/console.error respectively, not console.log", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const logger = createLogger("test.component");
    logger.warn("degraded");
    logger.error("failed");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
