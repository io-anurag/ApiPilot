import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { BenchmarkCandidateResult, ModelDType } from "@apipilot/shared-domain";
import { LocalProvider } from "../localProvider";
import { loadAIConfig } from "../modelConfig";
import { buildBenchmarkReport } from "./report";
import { SAMPLE_WORKLOADS, WORKLOAD_SET_ID } from "./workloads";

interface BenchmarkCandidate {
  modelId: string;
  /** Pins an ONNX quantization instead of Transformers.js's fp32-on-CPU default, which
   * is an impractically large download/runtime footprint for a multi-billion-parameter
   * model (e.g. Phi-3-mini's fp32 weights are ~16GB vs. ~2.5GB at q4). */
  dtype?: ModelDType;
}

/** Shortlisted candidates evaluated by this harness (research.md #2, constitution VII). */
const CANDIDATES: BenchmarkCandidate[] = [
  { modelId: "onnx-community/Qwen2.5-0.5B-Instruct" },
  { modelId: "Xenova/LaMini-Flan-T5-248M" },
  // Corrected repo ids (previously missing the "-ONNX" suffix, which does not exist on
  // Hugging Face and made these candidates fail to load in every prior benchmark run).
  { modelId: "onnx-community/Phi-3-mini-4k-instruct-ONNX", dtype: "q4" },
  // Added to evaluate whether a larger context window (128k vs. Qwen2.5's 32768) avoids
  // the context-limit failures observed enhancing large ApiModel/TestModel prompts in
  // production; MIT-licensed, meeting the permissive-license shortlist criterion
  // (research.md #2). Pinned to q4 (~2.5GB) rather than the ~16GB fp32 default.
  { modelId: "onnx-community/Phi-3-mini-128k-instruct-ONNX", dtype: "q4" },
];

async function evaluateCandidate(candidate: BenchmarkCandidate, cacheDir: string): Promise<BenchmarkCandidateResult> {
  const { modelId, dtype } = candidate;
  const provider = new LocalProvider({
    modelId,
    cacheDir,
    useAccelerator: false,
    inferenceTimeoutMs: 120_000,
    dtype,
  });

  let successCount = 0;
  let totalLatencyMs = 0;
  let peakMemoryMb = 0;

  for (const workload of SAMPLE_WORKLOADS) {
    const startedAt = performance.now();
    const response = await provider.infer({
      contractVersion: 1,
      requestId: `benchmark-${modelId}-${workload.id}`,
      input: workload.input,
      expectedOutputFormat: workload.expectedOutputFormat,
    });
    totalLatencyMs += performance.now() - startedAt;
    peakMemoryMb = Math.max(peakMemoryMb, process.memoryUsage().rss / (1024 * 1024));

    if (response.status === "success" && isParseableOutput(response.content, workload.expectedOutputFormat)) {
      successCount += 1;
    }
  }

  return {
    modelId,
    structuredOutputSuccessRate: successCount / SAMPLE_WORKLOADS.length,
    averageLatencyMs: totalLatencyMs / SAMPLE_WORKLOADS.length,
    peakMemoryMb,
    notes: dtype ? `dtype=${dtype}` : undefined,
  };
}

function isParseableOutput(content: string | undefined, format: "text" | "json"): boolean {
  if (!content) {
    return false;
  }
  if (format === "text") {
    return content.trim().length > 0;
  }
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function selectBest(candidates: BenchmarkCandidateResult[]): { modelId: string; rationale: string } {
  const ranked = [...candidates].sort((a, b) =>
    b.structuredOutputSuccessRate !== a.structuredOutputSuccessRate
      ? b.structuredOutputSuccessRate - a.structuredOutputSuccessRate
      : a.averageLatencyMs - b.averageLatencyMs,
  );
  const winner = ranked[0];
  return {
    modelId: winner.modelId,
    rationale:
      `Highest structured-output success rate (${(winner.structuredOutputSuccessRate * 100).toFixed(0)}%) ` +
      `among evaluated candidates; average latency ${winner.averageLatencyMs.toFixed(0)}ms is acceptable for ` +
      "interactive CPU use (research.md #2, constitution VII, Model Selection Is an Engineering Decision).",
  };
}

async function main(): Promise<void> {
  const { model } = loadAIConfig();
  const candidates: BenchmarkCandidateResult[] = [];

  for (const candidate of CANDIDATES) {
    const dtypeSuffix = candidate.dtype ? " (dtype=" + candidate.dtype + ")" : "";
    // eslint-disable-next-line no-console
    console.log(`Benchmarking ${candidate.modelId}${dtypeSuffix}...`);
    try {
      candidates.push(await evaluateCandidate(candidate, model.cacheDir));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Skipping ${candidate.modelId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error("No candidate model could be evaluated; see logged errors above");
  }

  const { modelId: selectedModelId, rationale } = selectBest(candidates);
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

  // eslint-disable-next-line no-console
  console.log(`Benchmark report written to ${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(`Selected model: ${selectedModelId}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Benchmark run failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
