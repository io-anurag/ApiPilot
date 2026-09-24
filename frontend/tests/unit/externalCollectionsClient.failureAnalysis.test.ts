import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFailureAnalysisInProgress,
  listFailureAnalyses,
  requestFailureAnalysis,
} from "../../src/services/externalCollectionsClient";

function stub(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: () => Promise.resolve(body) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("failure analysis client (contracts/failure-analysis-api.md)", () => {
  it("returns a 200 attempt as ok, including AI failures", async () => {
    const fetchMock = stub(200, { status: "ai-failed", aiErrorCategory: "TIMEOUT", message: "Too slow." });

    const result = await requestFailureAnalysis("uc-1", "run-1", 2);

    expect(result).toEqual({ ok: true, attempt: { status: "ai-failed", aiErrorCategory: "TIMEOUT", message: "Too slow." } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/external-collections/uc-1/execution/runs/run-1/results/2/failure-analysis",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps 409 failure_analysis_in_progress to an error naming the busy result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stub(409, { error: "failure_analysis_in_progress", message: "Busy.", runId: "run-9", resultIndex: 4 });

    expect(await requestFailureAnalysis("uc-1", "run-1", 2)).toMatchObject({
      ok: false,
      error: "failure_analysis_in_progress",
      runId: "run-9",
      inProgressResultIndex: 4,
    });
  });

  it("maps 409 result_not_failed with its outcome", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stub(409, { error: "result_not_failed", message: "Passed.", outcome: "passed" });
    expect(await requestFailureAnalysis("uc-1", "run-1", 0)).toMatchObject({
      ok: false,
      error: "result_not_failed",
      outcome: "passed",
    });
  });

  it("reads 204 as nothing in progress, and 200 as the entry", async () => {
    stub(204, null);
    expect(await getFailureAnalysisInProgress()).toEqual({ ok: true, inProgress: null });

    const entry = { runId: "run-1", resultIndex: 0, requestName: "x", phase: "generating", phaseStartedAt: "t" };
    stub(200, { inProgress: entry });
    expect(await getFailureAnalysisInProgress()).toEqual({ ok: true, inProgress: entry });
  });

  it("lists stored analyses", async () => {
    stub(200, { analyses: [{ runId: "run-1", resultIndex: 1 }] });
    expect(await listFailureAnalyses("uc-1", "run-1")).toEqual({ ok: true, analyses: [{ runId: "run-1", resultIndex: 1 }] });
  });
});
