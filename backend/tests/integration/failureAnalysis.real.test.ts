import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AIProvider, FailureAnalysis, UploadedCollectionExecutionRun } from "@apipilot/shared-domain";
import { extractJsonObjects, stripCodeFence } from "../../src/ai/jsonResponseParsing";
import { LocalProvider } from "../../src/ai/localProvider";
import { loadAIConfig } from "../../src/ai/modelConfig";
import { analyzeFailure } from "../../src/failureAnalysis/analyzeFailure";
import { createInProgressRegistry } from "../../src/failureAnalysis/inProgressRegistry";
import type { FailureAnalysisStore } from "../../src/failureAnalysis/failureAnalysisStore";
import { namesDifferentCause } from "../../src/failureAnalysis/parseFailureAnalysisResponse";
import { EVALUATION_CORPUS } from "../fixtures/failureAnalysis/evaluationCorpus";
import { completedWorkflow } from "../fixtures/failureAnalysis/workflowFixtures";

const REAL_MODEL_ENABLED = process.env.AI_TEST_REAL_MODEL === "1";

/**
 * Opt-in real-model evaluation of AP-031's AI explanation (specs/030-ai-failure-analysis research
 * D20, SC-006; constitution XXII). Never part of `npm test`: run
 * `npm run test:ai-real:failure-analysis -w backend`. The rules are verified separately, in
 * `npm test` (classifyFailure.test.ts); here the cause is fixed by them, and only the explanation
 * is measured. Soft by design: a weak score is evidence for a decision, not a build failure.
 */

/** Whether a rejected raw answer was rejected for naming a different cause (research D20). */
function rawAnswerContradicts(raw: string, conclusion: FailureAnalysis["conclusion"]): boolean {
  for (const candidate of [stripCodeFence(raw), ...extractJsonObjects(raw)]) {
    try {
      const parsed = JSON.parse(candidate) as { summary?: unknown; steps?: unknown };
      const texts = [
        ...(typeof parsed.summary === "string" ? [parsed.summary] : []),
        ...(Array.isArray(parsed.steps) ? parsed.steps.filter((step): step is string => typeof step === "string") : []),
      ];
      if (texts.length > 0) return namesDifferentCause(texts, conclusion);
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}

/** The AI error category or `not-viable` for an unavailable explanation; empty when available. */
function unavailableReason(explanation: FailureAnalysis["explanation"]): string {
  if (explanation.status === "available") return "";
  return explanation.reason.kind === "ai-error" ? explanation.reason.aiErrorCategory : "not-viable";
}

describe.runIf(REAL_MODEL_ENABLED)("AI failure analysis — real-model evaluation of the explanation (opt-in)", () => {
  it(
    "reports the usable-explanation rate, contradiction rate and latency against SC-006",
    async () => {
      const config = loadAIConfig();
      const cacheDir = process.env.AI_MODEL_CACHE_DIR?.trim() || path.resolve("models");
      const useAccelerator = process.env.AI_USE_ACCELERATOR === "true";
      const local = new LocalProvider({ ...config.model, cacheDir, useAccelerator }, undefined, config.planning);
      // Capture each raw answer, so a rejection can be attributed to a contradiction (D20).
      let lastRaw = "";
      const provider = new Proxy(local, {
        get: (target, property) => {
          if (property === "infer") {
            return async (...args: Parameters<AIProvider["infer"]>) => {
              const response = await target.infer(...args);
              lastRaw = response.content ?? "";
              return response;
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as AIProvider;

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

        lastRaw = "";
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

        const { conclusion, explanation } = attempt.analysis;
        const decided = conclusion.kind === "likely-cause" ? conclusion.cause : "insufficient-evidence";
        const unavailableCategory = unavailableReason(explanation);
        const contradicted =
          unavailableCategory === "INVALID_RESPONSE" && rawAnswerContradicts(lastRaw, conclusion) ? 1 : 0;
        rows.push({
          id: evaluationCase.id,
          origin: evaluationCase.origin,
          expected: evaluationCase.expected,
          decided,
          rule: conclusion.kind === "likely-cause" ? conclusion.ruleId : conclusion.reason,
          ruleAgrees: decided === evaluationCase.expected ? 1 : 0,
          explanation: explanation.status === "available" ? "available" : `unavailable:${unavailableCategory}`,
          usable: explanation.status === "available" ? 1 : 0,
          contradicted,
          latencyMs,
        });
      }

      const total = rows.length;
      const sum = (key: string) => rows.reduce((acc, row) => acc + Number(row[key]), 0);
      const latencies = rows.map((row) => Number(row.latencyMs)).sort((a, b) => a - b);
      const summary = {
        modelId: config.model.modelId,
        useAccelerator,
        cases: total,
        // Also verified in `npm test`; repeated here so each report is self-contained.
        ruleAgreementRate: sum("ruleAgrees") / total,
        // Passed validation: structured, at least one valid citation, no contradiction (D16, D20).
        usableRate: sum("usable") / total,
        // Share of all answers rejected for naming a different cause; counts against both (D20).
        contradictionRate: sum("contradicted") / total,
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
      // SC-006's explanation bar (research D20).
      expect.soft(summary.usableRate).toBeGreaterThanOrEqual(0.8);
      expect.soft(summary.contradictionRate).toBeLessThanOrEqual(0.1);
    },
    60 * 60 * 1000,
  );
});
