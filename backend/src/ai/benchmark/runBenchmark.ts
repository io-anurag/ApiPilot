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
 * Candidates evaluated by this harness (research.md #2, constitution VII). Every entry states its
 * dtype. fp32 is what an unset `AI_MODEL_DTYPE` loads on CPU, pinned here so the result records it.
 *
 * Qwen3-1.7B is the default model (specs/013 research.md Decision 11) and is run at both fp32 and q8,
 * so the dtype the default runs at is a recorded comparison rather than an assumption. Qwen2.5-0.5B
 * at fp32 stays as the reference the default replaced.
 *
 * LaMini-Flan-T5, the two Phi-3 models and Qwen2.5-0.5B at q8 are not run: Phi-3 scored 0 to 33% at
 * 270 to 320 s per request in the AP-004 benchmark and each needs a multi-gigabyte download, and
 * Qwen2.5-0.5B at q8 scored 0% under every prompt tried. Re-add them only with a reason.
 */
const CANDIDATES: BenchmarkCandidate[] = [
  { modelId: "onnx-community/Qwen3-1.7B-ONNX", dtype: "fp32" },
  { modelId: "onnx-community/Qwen3-1.7B-ONNX", dtype: "q8" },
  { modelId: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "fp32" },
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

  const {
    modelId: selectedModelId,
    dtype: selectedDtype,
    qualified,
    rationale,
  } = selectBest(candidates, model.modelId);
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
  logger.info(qualified ? "benchmark_model_selected" : "benchmark_no_candidate_qualified", {
    modelId: selectedModelId,
    dtype: selectedDtype,
  });
}

main().catch((error: unknown) => {
  logger.error("benchmark_run_failed", {
    errorCategory: error instanceof Error ? error.name : typeof error,
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
