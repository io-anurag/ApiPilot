import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadSpecification } from "../../src/services/specificationsClient";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function testFile(): File {
  return new File(["openapi: 3.0.0"], "spec.yaml", { type: "application/yaml" });
}

describe("specificationsClient logging (FR-010)", () => {
  it("logs a structured entry when a network error is caught", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await uploadSpecification(testFile());

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "specificationsClient",
      operation: "uploadSpecification",
      errorCategory: "network_error",
    });
  });

  it("logs a structured entry when the backend returns a non-2xx response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: "invalid_yaml", message: "Malformed document" }),
      } as Response),
    );

    const result = await uploadSpecification(testFile());

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "specificationsClient",
      operation: "uploadSpecification",
      errorCategory: "invalid_yaml",
      statusCode: 422,
    });
  });
});
