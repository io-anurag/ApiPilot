import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { BenchmarkCandidateResult } from "@apipilot/shared-domain";
import { LocalProvider } from "../localProvider";
import { loadAIConfig } from "../modelConfig";
import { buildBenchmarkReport } from "./report";
import { SAMPLE_WORKLOADS, WORKLOAD_SET_ID } from "./workloads";

/** Shortlisted candidates evaluated by this harness (research.md #2, constitution VII). */
const CANDIDATE_MODEL_IDS = [
  "onnx-community/Qwen2.5-0.5B-Instruct",
  "Xenova/LaMini-Flan-T5-248M",
  "onnx-community/Phi-3-mini-4k-instruct",
];

async function evaluateCandidate(modelId: string, cacheDir: string): Promise<BenchmarkCandidateResult> {
  const provider = new LocalProvider({
    modelId,
    cacheDir,
    useAccelerator: false,
    inferenceTimeoutMs: 120_000,
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

  for (const modelId of CANDIDATE_MODEL_IDS) {
    // eslint-disable-next-line no-console
    console.log(`Benchmarking ${modelId}...`);
    try {
      candidates.push(await evaluateCandidate(modelId, model.cacheDir));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Skipping ${modelId}: ${error instanceof Error ? error.message : String(error)}`);
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
