import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FailureAnalysis, UploadedCollectionExecutionRun } from "@apipilot/shared-domain";
import { LocalProvider } from "../../src/ai/localProvider";
import { loadAIConfig } from "../../src/ai/modelConfig";
import { analyzeFailure } from "../../src/failureAnalysis/analyzeFailure";
import { createInProgressRegistry } from "../../src/failureAnalysis/inProgressRegistry";
import type { FailureAnalysisStore } from "../../src/failureAnalysis/failureAnalysisStore";
import { EVALUATION_CORPUS } from "../fixtures/failureAnalysis/evaluationCorpus";
import { completedWorkflow } from "../fixtures/failureAnalysis/workflowFixtures";

const REAL_MODEL_ENABLED = process.env.AI_TEST_REAL_MODEL === "1";

/**
 * Opt-in real-model evaluation of AP-031 (specs/030-ai-failure-analysis research D11, constitution
 * XXII). Never part of `npm test`: run `npm run test:ai-real:failure-analysis -w backend`. Prints
 * the metrics recorded in `specs/030-ai-failure-analysis/evaluation.md`. Soft by design: a weak
 * score is evidence for a decision, not a build failure.
 */
describe.runIf(REAL_MODEL_ENABLED)("AI failure analysis — real-model evaluation (opt-in)", () => {
  it(
    "reports structured-output success, cause agreement, citation validity, confidence and latency",
    async () => {
      const config = loadAIConfig();
      const cacheDir = process.env.AI_MODEL_CACHE_DIR?.trim() || path.resolve("models");
      const useAccelerator = process.env.AI_USE_ACCELERATOR === "true";
      const provider = new LocalProvider({ ...config.model, cacheDir, useAccelerator }, undefined, config.planning);

      const rows: Array<Record<string, string | number>> = [];
      for (const evaluationCase of EVALUATION_CORPUS) {
        const stored = new Map<string, FailureAnalysis>();
        const store: FailureAnalysisStore = {
          saveAnalysis: (analysis) => stored.set("one", analysis),
          getAnalysis: () => stored.get("one"),
          listAnalyses: () => [...stored.values()],
        };
        const run: UploadedCollectionExecutionRun = {
          id: `eval-${evaluationCase.id}`,
          source: "uploaded",
          uploadedCollectionSetId: "eval",
          uploadedCollectionSnapshot: { name: "eval", tier: "local" },
          status: "completed",
          startedAt: new Date(0).toISOString(),
          summary: { total: 1, passed: 0, failed: 1, notAttempted: 0, durationMs: 0 },
          results: [evaluationCase.result],
          cancelRequested: false,
        };

        const startedAt = Date.now();
        const attempt = await analyzeFailure(
          {
            provider,
            store,
            registry: createInProgressRegistry(),
            now: () => new Date(),
            getWorkflow: () => (evaluationCase.withWorkflow ? completedWorkflow() : undefined),
            getCollectionVariableValues: () => undefined,
            viability: {
              rates: { prefillMsPerToken: config.planning.prefillMsPerToken, decodeMsPerToken: config.planning.decodeMsPerToken },
              safetyFactor: config.planning.viabilitySafetyFactor,
              budgetMs: config.model.inferenceTimeoutMs,
            },
          },
          { sessionId: "eval", run, resultIndex: 0 },
        );
        const latencyMs = Date.now() - startedAt;

        if (attempt.status === "analyzed") {
          const { conclusion } = attempt.analysis;
          const predicted = conclusion.kind === "likely-cause" ? conclusion.cause : "insufficient-evidence";
          rows.push({
            id: evaluationCase.id,
            origin: evaluationCase.origin,
            expected: evaluationCase.expected,
            predicted,
            reason: conclusion.kind === "insufficient-evidence" ? conclusion.reason : "",
            agrees: predicted === evaluationCase.expected ? 1 : 0,
            structured: 1,
            citedValid: attempt.analysis.citedEvidenceIds.length > 0 ? 1 : 0,
            confidence: conclusion.confidence ?? -1,
            latencyMs,
          });
        } else {
          rows.push({
            id: evaluationCase.id,
            origin: evaluationCase.origin,
            expected: evaluationCase.expected,
            predicted: attempt.status === "ai-failed" ? `ai-failed:${attempt.aiErrorCategory}` : "not-viable",
            reason: "",
            agrees: 0,
            structured: 0,
            citedValid: 0,
            confidence: -1,
            latencyMs,
          });
        }
      }

      const total = rows.length;
      const sum = (key: string) => rows.reduce((acc, row) => acc + Number(row[key]), 0);
      const structured = rows.filter((row) => row.structured === 1);
      const latencies = rows.map((row) => Number(row.latencyMs)).sort((a, b) => a - b);
      const summary = {
        modelId: config.model.modelId,
        useAccelerator,
        cases: total,
        structuredOutputSuccessRate: sum("structured") / total,
        causeAgreementRate: sum("agrees") / total,
        validCitationRateOfStructured: structured.length ? sum("citedValid") / structured.length : 0,
        meanConfidenceOfStructured: structured.length
          ? structured.reduce((acc, row) => acc + Number(row.confidence), 0) / structured.length
          : 0,
        medianLatencyMs: latencies[Math.floor(latencies.length / 2)],
        maxLatencyMs: latencies.at(-1),
      };
      // The report is this test's output. It is written past Vitest's console capture, and to a
      // git-ignored file, so it survives a passing run (recorded in evaluation.md).
      const report = JSON.stringify({ runAt: new Date().toISOString(), summary, rows }, null, 2);
      const reportPath = path.resolve("logs", "failure-analysis-evaluation.json");
      mkdirSync(path.dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${report}\n`);
      process.stdout.write(`FAILURE_ANALYSIS_EVALUATION ${report}\n`);

      expect(rows).toHaveLength(EVALUATION_CORPUS.length);
      expect.soft(summary.structuredOutputSuccessRate).toBeGreaterThanOrEqual(0.8);
    },
    60 * 60 * 1000,
  );
});
