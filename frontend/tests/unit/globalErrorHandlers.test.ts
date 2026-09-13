import { afterEach, describe, expect, it, vi } from "vitest";
import { installGlobalErrorHandlers } from "../../src/globalErrorHandlers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("installGlobalErrorHandlers (FR-010a, SC-007)", () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it("logs exactly one error-level entry for a synthetic uncaught exception", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    uninstall = installGlobalErrorHandlers();

    const event = new ErrorEvent("error", {
      message: "boom",
      filename: "app.js",
      lineno: 42,
      error: new Error("boom"),
    });
    window.dispatchEvent(event);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "globalErrorHandlers",
      event: "uncaught_exception",
      message: "boom",
    });
  });

  it("logs exactly one error-level entry for a synthetic unhandled promise rejection", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    uninstall = installGlobalErrorHandlers();

    // jsdom does not implement a real PromiseRejectionEvent constructor; a plain Event carrying
    // a `reason` property is sufficient to exercise the listener deterministically without an
    // actual unhandled rejection reaching the test runner (research.md Decision 4).
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("rejected");
    window.dispatchEvent(event);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "globalErrorHandlers",
      event: "unhandled_rejection",
      message: "rejected",
    });
  });
});
