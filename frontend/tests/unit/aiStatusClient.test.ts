import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAiStatus } from "../../src/services/aiStatusClient";

const FULL_PAYLOAD = {
  state: "ready",
  modelId: "secret/model-id",
  provider: "local",
  acceleratorRequested: false,
  acceleratorActive: false,
  reason: null,
  updatedAt: "2026-10-10T10:00:00.000Z",
  lastKnownReadiness: { state: "ready", reason: null, modelId: "secret/model-id", updatedAt: "2026-10-09T10:00:00.000Z" },
  latestBenchmarkRun: { runAt: "x", selectedModelId: "secret/model-id", selectionRationale: "because" },
};

function stub(response: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(response));
}

describe("fetchAiStatus (AP-054 Home)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads state and provider only, never the model identifier or benchmark data", async () => {
    stub(async () => ({ ok: true, status: 200, json: () => Promise.resolve(FULL_PAYLOAD) }));
    const result = await fetchAiStatus();
    expect(result).toEqual({ ok: true, status: { state: "ready", provider: "local", reason: null } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("carries the reason of an unavailable provider", async () => {
    stub(async () => ({ ok: true, status: 200, json: () => Promise.resolve({ ...FULL_PAYLOAD, state: "unavailable", provider: "mock", reason: "Model failed to load." }) }));
    expect(await fetchAiStatus()).toEqual({ ok: true, status: { state: "unavailable", provider: "mock", reason: "Model failed to load." } });
  });

  it.each(["loading", "not-loaded"])("maps the %s state", async (state) => {
    stub(async () => ({ ok: true, status: 200, json: () => Promise.resolve({ ...FULL_PAYLOAD, state }) }));
    const result = await fetchAiStatus();
    expect(result.ok && result.status.state).toBe(state);
  });

  it("refuses a payload it does not understand rather than guessing", async () => {
    stub(async () => ({ ok: true, status: 200, json: () => Promise.resolve({ state: "weird", provider: "cloud" }) }));
    expect(await fetchAiStatus()).toMatchObject({ ok: false });
  });

  it("reports a non-2xx response and a network failure as unavailable, without throwing", async () => {
    stub(async () => ({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    expect(await fetchAiStatus()).toEqual({ ok: false, message: "Request failed with status 500" });
    stub(async () => {
      throw new Error("down");
    });
    expect(await fetchAiStatus()).toEqual({ ok: false, message: "down" });
  });
});
