import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AIErrorCategory,
  FailureAnalysis,
  UploadedCollectionExecutionRun,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import { analyzeFailure, type AnalyzeFailureDeps } from "../../../src/failureAnalysis/analyzeFailure";
import { createInProgressRegistry } from "../../../src/failureAnalysis/inProgressRegistry";
import { FAILURE_ANALYSIS_RESPONSE_VERSION } from "../../../src/failureAnalysis/failureAnalysisPrompt";
import type { FailureAnalysisStore } from "../../../src/failureAnalysis/failureAnalysisStore";
import {
  FailureAnalysisInProgressError,
  ResultNotFailedError,
  ResultNotFoundError,
} from "../../../src/failureAnalysis/errors";
import {
  SECRET_VALUES,
  type ScriptedProvider,
  failedResult,
  failingProvider,
  modelAnswer,
  sampleAnalysis,
  scriptedProvider,
  withRawCapture,
} from "../../fixtures/failureAnalysis/fixtures";
import { STANDALONE_ITEM_ID, completedWorkflow } from "../../fixtures/failureAnalysis/workflowFixtures";

const NOW = new Date("2026-09-23T10:00:00.000Z");

function run(results: UploadedRequestResult[]): UploadedCollectionExecutionRun {
  return {
    id: "run-1",
    source: "uploaded",
    uploadedCollectionSetId: "uc-1",
    uploadedCollectionSnapshot: { name: "c", tier: "local" },
    status: "completed",
    startedAt: NOW.toISOString(),
    summary: { total: results.length, passed: 0, failed: results.length, notAttempted: 0, durationMs: 0 },
    results,
    cancelRequested: false,
  };
}

type MemoryStore = FailureAnalysisStore & { rows: Map<string, FailureAnalysis>; saves: number };

function memoryStore(initial: FailureAnalysis[] = []): MemoryStore {
  const rows = new Map(initial.map((analysis) => [`${analysis.runId}:${analysis.resultIndex}`, analysis]));
  const store: MemoryStore = {
    rows,
    saves: 0,
    saveAnalysis(analysis) {
      store.saves += 1;
      rows.set(`${analysis.runId}:${analysis.resultIndex}`, analysis);
    },
    getAnalysis: (runId, resultIndex) => rows.get(`${runId}:${resultIndex}`),
    listAnalyses: (runId) => [...rows.values()].filter((analysis) => analysis.runId === runId),
  };
  return store;
}

type TestDeps = AnalyzeFailureDeps & { provider: ScriptedProvider; store: MemoryStore };

function deps(
  provider: ScriptedProvider,
  overrides: Partial<Omit<AnalyzeFailureDeps, "provider" | "store">> & { store?: MemoryStore } = {},
): TestDeps {
  const { store, ...rest } = overrides;
  return {
    registry: createInProgressRegistry(() => NOW),
    now: () => NOW,
    getWorkflow: () => undefined,
    getCollectionVariableValues: () => ({ apiToken: "var-secret-9", baseUrl: "http://localhost" }),
    viability: { rates: { prefillMsPerToken: 1, decodeMsPerToken: 1 }, safetyFactor: 1, budgetMs: 120_000 },
    ...rest,
    provider,
    store: store ?? memoryStore(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("analyzeFailure — US1", () => {
  it("analyzes a failed result, stores it, and records provenance", async () => {
    const d = deps(scriptedProvider([modelAnswer()]));
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });

    expect(attempt.status).toBe("analyzed");
    if (attempt.status !== "analyzed") return;
    expect(attempt.analysis).toMatchObject({
      runId: "run-1",
      resultIndex: 0,
      requestName: "Create user",
      conclusion: { kind: "likely-cause", cause: "environment-issue", confidence: 0.72 },
      citedEvidenceIds: ["E1", "E2"],
      specificationContext: { status: "unavailable", reason: "no-request-identity" },
      provenance: {
        source: "AI",
        aiModel: "test-model",
        aiProvider: "local",
        responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
        confidenceThreshold: 0.5,
        generatedAt: NOW.toISOString(),
      },
    });
    expect(d.store.getAnalysis("run-1", 0)).toEqual(attempt.analysis);
  });

  it("uses the session's current workflow for specification context", async () => {
    const d = deps(scriptedProvider([modelAnswer()]), { getWorkflow: completedWorkflow });
    const attempt = await analyzeFailure(d, {
      sessionId: "s1",
      run: run([failedResult({ itemId: STANDALONE_ITEM_ID })]),
      resultIndex: 0,
    });
    expect(attempt.status === "analyzed" && attempt.analysis.specificationContext.status).toBe("matched");
  });

  it("moves the in-progress phase to generating when the provider starts, and clears it afterwards", async () => {
    const d = deps(scriptedProvider([modelAnswer()]));
    const phases: Array<string | undefined> = [];
    const provider: ScriptedProvider = {
      ...d.provider,
      infer: async (request, hooks) => {
        phases.push(d.registry.get("s1")?.phase);
        hooks?.onStarted?.();
        phases.push(d.registry.get("s1")?.phase);
        return d.provider.infer(request);
      },
    };

    await analyzeFailure({ ...d, provider }, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });

    expect(phases).toEqual(["waiting-for-ai", "generating"]);
    expect(d.registry.get("s1")).toBeUndefined();
  });

  it("clears the in-progress entry when an unexpected error is thrown", async () => {
    const d = deps(scriptedProvider([modelAnswer()]));
    const provider: ScriptedProvider = {
      ...d.provider,
      infer: async () => {
        throw new Error("boom");
      },
    };
    await expect(
      analyzeFailure({ ...d, provider }, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 }),
    ).rejects.toThrow("boom");
    expect(d.registry.get("s1")).toBeUndefined();
  });

  it("rejects a second analysis in the same session while one is in progress (FR-016)", async () => {
    const d = deps(scriptedProvider([modelAnswer()]));
    d.registry.tryBegin("s1", { runId: "run-9", resultIndex: 4, requestName: "other" });

    await expect(
      analyzeFailure(d, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 }),
    ).rejects.toEqual(new FailureAnalysisInProgressError("run-9", 4));
    expect(d.provider.requests).toHaveLength(0);
  });

  it("returns ai-failed with the category, writes nothing, for a provider error", async () => {
    const d = deps(failingProvider("PROVIDER_UNAVAILABLE"));
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });

    expect(attempt).toEqual({
      status: "ai-failed",
      aiErrorCategory: "PROVIDER_UNAVAILABLE",
      message: "The local AI provider is unavailable, so no analysis was produced.",
    });
    expect(d.store.saves).toBe(0);
  });

  it("scans the model's summary and steps for sensitive values", async () => {
    const answer = modelAnswer({
      summary: "The token SECRET2 and var-secret-9 were rejected.",
      steps: ["Rotate abc.def.ghi and retry."],
    });
    const d = deps(scriptedProvider([answer]));
    const attempt = await analyzeFailure(d, {
      sessionId: "s1",
      run: run([withRawCapture(failedResult())]),
      resultIndex: 0,
    });

    const text = attempt.status === "analyzed" ? JSON.stringify(attempt.analysis) : "";
    for (const secret of [...SECRET_VALUES, "var-secret-9"]) expect(text).not.toContain(secret);
  });

  it("never calls the provider for an ineligible result", async () => {
    const d = deps(scriptedProvider([modelAnswer()]));
    const passed = { ...failedResult(), outcome: "passed" as const, failureCategory: undefined };

    await expect(analyzeFailure(d, { sessionId: "s1", run: run([passed]), resultIndex: 0 })).rejects.toBeInstanceOf(
      ResultNotFailedError,
    );
    await expect(analyzeFailure(d, { sessionId: "s1", run: run([passed]), resultIndex: 3 })).rejects.toBeInstanceOf(
      ResultNotFoundError,
    );
    expect(d.provider.requests).toHaveLength(0);
  });

  it.each([
    ["an invalid answer", scriptedProvider(["not json"]), "ai-failed"],
    ["a timeout", failingProvider("TIMEOUT"), "ai-failed"],
    ["a success", scriptedProvider([modelAnswer()]), "analyzed"],
  ] as const)("calls the provider exactly once for %s — no hidden retry (FR-012)", async (_label, provider, status) => {
    const d = deps(provider);
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });
    expect(attempt.status).toBe(status);
    expect(provider.requests).toHaveLength(1);
  });

  it("logs identifiers and counts only — never secrets, summary or evidence text (SC-003)", async () => {
    const lines: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
    }
    const d = deps(scriptedProvider([modelAnswer({ summary: "Distinctive summary text 42." })]));

    const attempt = await analyzeFailure(d, {
      sessionId: "s1",
      run: run([withRawCapture(failedResult())]),
      resultIndex: 0,
    });

    const logged = lines.join("\n");
    expect(logged).toContain("failure_analysis_settled");
    for (const secret of SECRET_VALUES) expect(logged).not.toContain(secret);
    expect(logged).not.toContain("Distinctive summary text 42.");
    if (attempt.status === "analyzed") {
      for (const item of attempt.analysis.evidence) expect(logged).not.toContain(item.text);
    }
  });
});

describe("analyzeFailure — US3", () => {
  it("refuses before inference when the projection exceeds the time budget", async () => {
    const d = deps(scriptedProvider([modelAnswer()]), {
      viability: { rates: { prefillMsPerToken: 1_000, decodeMsPerToken: 1_000 }, safetyFactor: 1, budgetMs: 1_000 },
    });
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });

    expect(attempt.status).toBe("not-viable");
    expect(attempt.status === "not-viable" && attempt.notViable.budgetMs).toBe(1_000);
    expect(attempt.status === "not-viable" && attempt.message).toContain("limited to");
    expect(d.provider.requests).toHaveLength(0);
  });

  it("trims body excerpts, then headers, to fit the model's input capacity", async () => {
    const result = withRawCapture(failedResult());
    const probe = deps(scriptedProvider([modelAnswer()]));
    await analyzeFailure(probe, { sessionId: "s1", run: run([result]), resultIndex: 0 });
    const fullLength = probe.provider.requests[0].input.length;

    const provider = scriptedProvider([modelAnswer()], { inputBudget: fullLength - 1 });
    const attempt = await analyzeFailure(deps(provider), { sessionId: "s1", run: run([result]), resultIndex: 0 });

    const kinds = attempt.status === "analyzed" ? attempt.analysis.evidence.map((item) => item.kind) : [];
    expect(kinds).not.toContain("request-body-excerpt");
    expect(kinds).toContain("omitted-for-capacity");
  });

  it("reports INVALID_REQUEST when the evidence still cannot fit after trimming", async () => {
    const provider = scriptedProvider([modelAnswer()], { inputBudget: 10 });
    const attempt = await analyzeFailure(deps(provider), {
      sessionId: "s1",
      run: run([withRawCapture(failedResult())]),
      resultIndex: 0,
    });

    expect(attempt.status === "ai-failed" && attempt.aiErrorCategory).toBe("INVALID_REQUEST");
    expect(provider.requests).toHaveLength(0);
  });

  it("keeps the stored analysis and returns it as previousAnalysis when a new attempt fails", async () => {
    const stored = sampleAnalysis({ runId: "run-1", resultIndex: 0 });
    const failing = deps(failingProvider("TIMEOUT"), { store: memoryStore([stored]) });
    const refused = deps(scriptedProvider([modelAnswer()]), {
      store: memoryStore([stored]),
      viability: { rates: { prefillMsPerToken: 1_000, decodeMsPerToken: 1_000 }, safetyFactor: 1, budgetMs: 1 },
    });

    const failed = await analyzeFailure(failing, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });
    const notViable = await analyzeFailure(refused, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });

    expect(failed).toMatchObject({ status: "ai-failed", previousAnalysis: stored });
    expect(notViable).toMatchObject({ status: "not-viable", previousAnalysis: stored });
    expect(failing.store.getAnalysis("run-1", 0)).toEqual(stored);
    expect(failing.store.saves).toBe(0);
  });

  it("stores an insufficient-evidence conclusion as a normal analysis", async () => {
    const d = deps(scriptedProvider([modelAnswer({ confidence: 0.3 })]));
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });

    expect(attempt.status === "analyzed" && attempt.analysis.conclusion).toEqual({
      kind: "insufficient-evidence",
      reason: "below-confidence-threshold",
      confidence: 0.3,
    });
    expect(d.store.saves).toBe(1);
  });

  it("gives each AI error category a distinct plain-language message without internal detail", async () => {
    const categories: AIErrorCategory[] = [
      "NOT_READY",
      "LOAD_FAILED",
      "TIMEOUT",
      "INVALID_REQUEST",
      "INVALID_RESPONSE",
      "PROVIDER_UNAVAILABLE",
    ];
    const messages = new Set<string>();
    for (const category of categories) {
      const attempt = await analyzeFailure(deps(failingProvider(category)), {
        sessionId: "s1",
        run: run([failedResult()]),
        resultIndex: 0,
      });
      const message = attempt.status === "ai-failed" ? attempt.message : "";
      expect(message).not.toMatch(/test-model|provider failure detail|\\|\/src\/|at .+\(/);
      messages.add(message);
    }
    expect(messages.size).toBe(categories.length);
  });
});
