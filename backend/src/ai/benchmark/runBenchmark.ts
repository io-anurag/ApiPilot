import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchmarkCandidateResult } from "@apipilot/shared-domain";
import { LocalProvider } from "../localProvider";
import { loadAIConfig } from "../modelConfig";
import { createLogger } from "../../logger";
import { getAiDiagnosticsRepository } from "../../persistence/aiDiagnosticsRepository";
import { evaluateCandidate, selectBest, type BenchmarkCandidate } from "./evaluateCandidate";
import { buildBenchmarkReport } from "./report";
import { ENHANCEMENT_WORKLOADS, WORKLOAD_SET_ID } from "./workloads";

const logger = createLogger("ai.benchmark");

/**
 * Shortlisted candidates evaluated by this harness (research.md #2, constitution VII). Every entry
 * states its dtype. fp32 is what an unset `AI_MODEL_DTYPE` loads on CPU, pinned here so the result
 * records it; the Qwen entry is also run at q8 because that quantization measured about 4x slower on
 * CPU and the comparison belongs in the recorded evidence, not in anecdote (specs/013 research.md
 * Decision 5). The Phi-3 entries stay at q4: their fp32 weights are about 16 GB against about 2.5 GB.
 */
const CANDIDATES: BenchmarkCandidate[] = [
  { modelId: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "fp32" },
  { modelId: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" },
  { modelId: "Xenova/LaMini-Flan-T5-248M", dtype: "fp32" },
  // Corrected repo ids (previously missing the "-ONNX" suffix, which does not exist on
  // Hugging Face and made these candidates fail to load in every prior benchmark run).
  { modelId: "onnx-community/Phi-3-mini-4k-instruct-ONNX", dtype: "q4" },
  // Added to evaluate whether a larger context window (128k vs. Qwen2.5's 32768) avoids
  // the context-limit failures observed enhancing large ApiModel/TestModel prompts in
  // production; MIT-licensed, meeting the permissive-license shortlist criterion (research.md #2).
  { modelId: "onnx-community/Phi-3-mini-128k-instruct-ONNX", dtype: "q4" },
];

async function main(): Promise<void> {
  const { model } = loadAIConfig();
  const candidates: BenchmarkCandidateResult[] = [];

  for (const candidate of CANDIDATES) {
    logger.info("benchmark_candidate_started", {
      modelId: candidate.modelId,
      dtype: candidate.dtype,
    });
    try {
      const provider = new LocalProvider({
        modelId: candidate.modelId,
        cacheDir: model.cacheDir,
        useAccelerator: false,
        inferenceTimeoutMs: 120_000,
        dtype: candidate.dtype,
      });
      candidates.push(await evaluateCandidate(candidate, provider, ENHANCEMENT_WORKLOADS));
    } catch (error) {
      logger.error("benchmark_candidate_skipped", {
        modelId: candidate.modelId,
        dtype: candidate.dtype,
        errorCategory: error instanceof Error ? error.name : typeof error,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error("No candidate model could be evaluated; see logged errors above");
  }

  const { modelId: selectedModelId, dtype: selectedDtype, rationale } = selectBest(candidates);
  const report = buildBenchmarkReport({
    workloadSetId: WORKLOAD_SET_ID,
    candidates,
    selectedModelId,
    selectionRationale: rationale,
  });

  const outputDir = fileURLToPath(
    new URL("../../../../specs/004-ai-provider-local-inference/", import.meta.url),
  );
  const outputPath = path.join(outputDir, "benchmark-results.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  // Additive: the JSON file above remains the durable, git-tracked engineering artifact
  // (constitution XXIII); this also records the same report so the running server can answer
  // "what did the last benchmark find" without filesystem access to a spec directory
  // (specs/025-local-persistence-layer research.md D6).
  getAiDiagnosticsRepository().recordBenchmarkRun(report);

  logger.info("benchmark_report_written", { outputPath });
  logger.info("benchmark_model_selected", { modelId: selectedModelId, dtype: selectedDtype });
}

main().catch((error: unknown) => {
  logger.error("benchmark_run_failed", {
    errorCategory: error instanceof Error ? error.name : typeof error,
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
