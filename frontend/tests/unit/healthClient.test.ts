import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "../../src/services/healthClient";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("healthClient logging (FR-010)", () => {
  it("logs a structured entry when a network error is caught", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("backend unreachable")));

    const result = await fetchHealth();

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "healthClient",
      operation: "fetchHealth",
      errorCategory: "network_error",
    });
  });

  it("logs a structured entry when the backend returns a non-2xx response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response),
    );

    const result = await fetchHealth();

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "healthClient",
      operation: "fetchHealth",
      errorCategory: "non_2xx_response",
      statusCode: 503,
    });
  });
});
