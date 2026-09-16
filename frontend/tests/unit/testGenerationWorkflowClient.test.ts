import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyScenarioDecisions,
  editScenario,
  fetchAiEnhancementProgress,
  fetchCurrentWorkflow,
  runDeterministicGeneration,
  startWorkflow,
} from "../../src/services/testGenerationWorkflowClient";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("testGenerationWorkflowClient logging (FR-010)", () => {
  it("logs via postJson/toWorkflowResult on a non-2xx response (runDeterministicGeneration)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "workflow_not_in_stage", message: "Wrong stage" }),
      } as Response),
    );

    const result = await runDeterministicGeneration();

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      level: "error",
      component: "testGenerationWorkflowClient",
      operation: "runDeterministicGeneration",
      errorCategory: "workflow_not_in_stage",
      statusCode: 409,
    });
  });

  it("logs via postJson on a network error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    await runDeterministicGeneration();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      operation: "runDeterministicGeneration",
      errorCategory: "network_error",
    });
  });

  it("logs via fetchCurrentWorkflow's own catch on a network error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    await fetchCurrentWorkflow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      operation: "fetchCurrentWorkflow",
      errorCategory: "network_error",
    });
  });

  it("logs via fetchAiEnhancementProgress's own catch on a network error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    await fetchAiEnhancementProgress();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      operation: "fetchAiEnhancementProgress",
      errorCategory: "network_error",
    });
  });

  it("fetchAiEnhancementProgress requests the progressOnly query variant and unwraps the snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        progress: { aiEnhancement: { status: "active" }, liveScenarios: [] },
      }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAiEnhancementProgress();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test-generation-workflow?progressOnly=true",
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      snapshot: { aiEnhancement: { status: "active" }, liveScenarios: [] },
    });
  });

  it("logs on startWorkflow's network error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    await startWorkflow(new File(["openapi: 3.0.0"], "spec.yaml"));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      operation: "startWorkflow",
      errorCategory: "network_error",
    });
  });

  it("logs via postScenarioAction on a non-2xx response (editScenario)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "stale_revision", message: "Revision mismatch" }),
      } as Response),
    );

    await editScenario("s1", 0, { request: { pathParameters: {}, queryParameters: {}, headers: {} } });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      operation: "editScenario",
      errorCategory: "stale_revision",
      statusCode: 409,
    });
  });

  it("logs on applyScenarioDecisions' network error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    await applyScenarioDecisions([{ scenarioId: "s1", revision: 0, action: "accept" }]);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      operation: "applyScenarioDecisions",
      errorCategory: "network_error",
    });
  });
});
