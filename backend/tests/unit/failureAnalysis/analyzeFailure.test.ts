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
  connectivityFailure,
  failedResult,
  failingProvider,
  modelAnswer,
  sampleAnalysis,
  scriptedProvider,
  unavailableExplanation,
  withRawCapture,
} from "../../fixtures/failureAnalysis/fixtures";
import { EVALUATION_CORPUS } from "../../fixtures/failureAnalysis/evaluationCorpus";
import { STANDALONE_ITEM_ID, completedWorkflow } from "../../fixtures/failureAnalysis/workflowFixtures";

const NOW = new Date("2026-09-24T10:00:00.000Z");

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

const NOT_VIABLE = { rates: { prefillMsPerToken: 1_000, decodeMsPerToken: 1_000 }, safetyFactor: 1, budgetMs: 1_000 };

/** A 500 whose recorded body names a dependency: decided by rule 4 from a trimmable body excerpt. */
const downstreamCase = () => {
  const found = EVALUATION_CORPUS.find((evaluationCase) => evaluationCase.id === "downstream-500-dependency");
  if (!found) throw new Error("corpus case missing");
  return found.result;
};

afterEach(() => vi.restoreAllMocks());

describe("analyzeFailure — US1 (rule-decided cause, AI explanation)", () => {
  it("decides the cause by rule, explains it with the AI, stores it and records split provenance", async () => {
    const d = deps(scriptedProvider([modelAnswer({ evidenceIds: ["E1"] })]));
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });

    expect(attempt.status).toBe("analyzed");
    if (attempt.status !== "analyzed") return;
    expect(attempt.analysis).toMatchObject({
      analysisVersion: 2,
      runId: "run-1",
      resultIndex: 0,
      requestName: "Get user",
      conclusion: { kind: "likely-cause", cause: "environment-issue", strength: "high", ruleId: "no-response", decidingEvidenceIds: ["E1"] },
      classificationProvenance: { source: "RULE", ruleSetVersion: 1 },
      explanation: {
        status: "available",
        citedEvidenceIds: ["E1"],
        provenance: { source: "AI", aiModel: "test-model", aiProvider: "local", responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION },
      },
      specificationContext: { status: "unavailable", reason: "no-request-identity" },
      analyzedAt: NOW.toISOString(),
    });
    expect(d.store.getAnalysis("run-1", 0)).toEqual(attempt.analysis);
  });

  it("never lets the AI change the cause: different answers give the same conclusion", async () => {
    const first = await analyzeFailure(deps(scriptedProvider([modelAnswer({ evidenceIds: ["E1"] })])), {
      sessionId: "s1",
      run: run([connectivityFailure()]),
      resultIndex: 0,
    });
    const second = await analyzeFailure(
      deps(scriptedProvider([modelAnswer({ summary: "Nothing answered the request at all.", evidenceIds: ["E1"] })])),
      { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 },
    );
    expect(first.analysis.conclusion).toEqual(second.analysis.conclusion);
  });

  it("gives the model the rule-decided cause to explain", async () => {
    const d = deps(scriptedProvider([modelAnswer({ evidenceIds: ["E1"] })]));
    await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });
    const prompt = JSON.parse(d.provider.requests[0].input) as { classification: { cause: string } };
    expect(prompt.classification.cause).toBe("Potential environment issue");
  });

  it("uses the session's current workflow for specification context", async () => {
    const d = deps(scriptedProvider([modelAnswer()]), { getWorkflow: completedWorkflow });
    const attempt = await analyzeFailure(d, {
      sessionId: "s1",
      run: run([failedResult({ itemId: STANDALONE_ITEM_ID })]),
      resultIndex: 0,
    });
    expect(attempt.analysis.specificationContext.status).toBe("matched");
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

    const text = JSON.stringify(attempt.analysis);
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
    ["an invalid answer", () => scriptedProvider(["not json"]), "unavailable"],
    ["a timeout", () => failingProvider("TIMEOUT"), "unavailable"],
    ["a success", () => scriptedProvider([modelAnswer()]), "available"],
  ] as const)("calls the provider exactly once for %s — no hidden retry (FR-012)", async (_label, makeProvider, explanation) => {
    const provider = makeProvider();
    const attempt = await analyzeFailure(deps(provider), { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });
    expect(attempt.analysis.explanation.status).toBe(explanation);
    expect(provider.requests).toHaveLength(1);
  });

  it("logs identifiers, the rule and the explanation status only — never secrets, summary or evidence text (SC-003)", async () => {
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
    const settled = JSON.parse(lines.find((line) => line.includes("failure_analysis_settled")) ?? "{}") as Record<string, unknown>;
    expect(settled).toMatchObject({ ruleId: "no-rule-matched", explanationStatus: "available" });
    for (const secret of SECRET_VALUES) expect(logged).not.toContain(secret);
    expect(logged).not.toContain("Distinctive summary text 42.");
    for (const item of attempt.analysis.evidence) expect(logged).not.toContain(item.text);
  });
});

describe("analyzeFailure — input capacity (research D8 revision; /speckit-analyze C1)", () => {
  it("stores the full evidence and trims only the prompt copy, keeping original ids", async () => {
    const result = downstreamCase();
    const probe = deps(scriptedProvider([modelAnswer()]));
    const full = await analyzeFailure(probe, { sessionId: "s1", run: run([result]), resultIndex: 0 });
    const fullLength = probe.provider.requests[0].input.length;

    const provider = scriptedProvider([modelAnswer({ evidenceIds: ["E1"] })], { inputBudget: fullLength - 1 });
    const trimmed = await analyzeFailure(deps(provider), { sessionId: "s1", run: run([result]), resultIndex: 0 });

    const prompt = JSON.parse(provider.requests[0].input) as { evidence: Array<{ id: string; text: string }>; note?: string };
    expect(prompt.evidence.some((item) => item.text.startsWith("Response body"))).toBe(false);
    expect(prompt.note).toContain("body excerpts");
    const storedIds = trimmed.analysis.evidence.map((item) => item.id);
    expect(prompt.evidence.every((item) => storedIds.includes(item.id))).toBe(true);
    expect(trimmed.analysis.evidence).toEqual(full.analysis.evidence);
    expect(trimmed.analysis.explanation.status).toBe("available");
  });

  it("gives the same cause, strength and deciding evidence whatever the model's budget (constitution XXIV)", async () => {
    const result = downstreamCase();
    const unlimited = await analyzeFailure(deps(scriptedProvider([modelAnswer()])), { sessionId: "s1", run: run([result]), resultIndex: 0 });
    const tiny = await analyzeFailure(deps(scriptedProvider([modelAnswer()], { inputBudget: 10 })), {
      sessionId: "s1",
      run: run([result]),
      resultIndex: 0,
    });

    expect(unlimited.analysis.conclusion).toMatchObject({ ruleId: "dependency-named-in-server-error" });
    expect(tiny.analysis.conclusion).toEqual(unlimited.analysis.conclusion);
    if (unlimited.analysis.conclusion.kind === "likely-cause") {
      const kinds = unlimited.analysis.conclusion.decidingEvidenceIds.map(
        (id) => unlimited.analysis.evidence.find((item) => item.id === id)?.kind,
      );
      expect(kinds).toContain("response-body-excerpt");
    }
  });

  it("makes the explanation unavailable with INVALID_REQUEST when even the trimmed prompt cannot fit", async () => {
    const provider = scriptedProvider([modelAnswer()], { inputBudget: 10 });
    const attempt = await analyzeFailure(deps(provider), {
      sessionId: "s1",
      run: run([withRawCapture(failedResult())]),
      resultIndex: 0,
    });

    expect(attempt.analysis.explanation).toMatchObject({
      status: "unavailable",
      reason: { kind: "ai-error", aiErrorCategory: "INVALID_REQUEST" },
    });
    expect(provider.requests).toHaveLength(0);
  });
});

describe("analyzeFailure — US3 (insufficient evidence, unavailable AI)", () => {
  it("returns insufficient evidence when no rule matches, and tells the model so", async () => {
    const d = deps(scriptedProvider([modelAnswer()]));
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([failedResult()]), resultIndex: 0 });

    expect(attempt.analysis.conclusion).toEqual({ kind: "insufficient-evidence", reason: "no-rule-matched" });
    const prompt = JSON.parse(d.provider.requests[0].input) as { classification: { cause: string } };
    expect(prompt.classification.cause).toBe("none");
    expect(d.store.saves).toBe(1);
  });

  it("stores the rule result with an unavailable explanation when the provider is not ready (FR-006)", async () => {
    const d = deps(failingProvider("NOT_READY"));
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });

    expect(attempt.status).toBe("analyzed");
    expect(attempt.analysis.conclusion).toMatchObject({ ruleId: "no-response" });
    expect(attempt.analysis.explanation).toMatchObject({ status: "unavailable", reason: { kind: "ai-error", aiErrorCategory: "NOT_READY" } });
    expect(d.store.getAnalysis("run-1", 0)).toEqual(attempt.analysis);
  });

  it("refuses inference when the projection exceeds the time budget, still storing the rule result", async () => {
    const d = deps(scriptedProvider([modelAnswer()]), { viability: NOT_VIABLE });
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });

    expect(attempt.analysis.explanation).toMatchObject({ status: "unavailable", reason: { kind: "not-viable", budgetMs: 1_000 } });
    expect(attempt.analysis.explanation.status === "unavailable" && attempt.analysis.explanation.message).toContain("limited to");
    expect(d.provider.requests).toHaveLength(0);
    expect(d.store.saves).toBe(1);
  });

  it("makes a contradicting answer an unavailable explanation, never a different cause (FR-008)", async () => {
    const d = deps(scriptedProvider([modelAnswer({ summary: "This is a specification mismatch.", evidenceIds: ["E1"] })]));
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });

    expect(attempt.analysis.conclusion).toMatchObject({ cause: "environment-issue" });
    expect(attempt.analysis.explanation).toMatchObject({
      status: "unavailable",
      reason: { kind: "ai-error", aiErrorCategory: "INVALID_RESPONSE" },
    });
  });

  it("keeps a stored analysis that has an explanation when the new explanation fails (FR-015)", async () => {
    const stored = sampleAnalysis();
    const d = deps(failingProvider("TIMEOUT"), { store: memoryStore([stored]) });
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });

    expect(attempt.status).toBe("kept-previous");
    if (attempt.status !== "kept-previous") return;
    expect(attempt.previousAnalysis).toEqual(stored);
    expect(attempt.analysis.explanation.status).toBe("unavailable");
    expect(attempt.message).toContain("earlier explanation");
    expect(d.store.saves).toBe(0);
    expect(d.store.getAnalysis("run-1", 0)).toEqual(stored);
  });

  it("replaces a stored analysis that has no explanation, even when the new explanation also fails", async () => {
    const stored = sampleAnalysis({ explanation: unavailableExplanation() });
    const d = deps(failingProvider("TIMEOUT"), { store: memoryStore([stored]) });
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });

    expect(attempt.status).toBe("analyzed");
    expect(d.store.saves).toBe(1);
  });

  it("replaces a stored analysis when the new explanation succeeds", async () => {
    const stored = sampleAnalysis();
    const d = deps(scriptedProvider([modelAnswer({ evidenceIds: ["E1"] })]), { store: memoryStore([stored]) });
    const attempt = await analyzeFailure(d, { sessionId: "s1", run: run([connectivityFailure()]), resultIndex: 0 });

    expect(attempt.status).toBe("analyzed");
    expect(d.store.getAnalysis("run-1", 0)).toEqual(attempt.analysis);
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
      const { explanation } = attempt.analysis;
      const message = explanation.status === "unavailable" ? explanation.message : "";
      expect(message).not.toMatch(/test-model|provider failure detail|\\|\/src\/|at .+\(/);
      messages.add(message);
    }
    expect(messages.size).toBe(categories.length);
  });
});
