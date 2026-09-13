import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEnvironments, startExecution } from "../../src/services/executionClient";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("executionClient logging (FR-010)", () => {
  it("logs a structured entry when a network error is caught", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const result = await fetchEnvironments();

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = errorSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "error",
      component: "executionClient",
      operation: "fetchEnvironments",
      errorCategory: "network_error",
    });
  });

  it("logs a structured entry when the backend returns a non-2xx response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "execution_in_progress", message: "A run is already active" }),
      } as Response),
    );

    const result = await startExecution("env-1");

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = errorSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "error",
      component: "executionClient",
      operation: "startExecution",
      errorCategory: "execution_in_progress",
      statusCode: 409,
    });
  });
});
