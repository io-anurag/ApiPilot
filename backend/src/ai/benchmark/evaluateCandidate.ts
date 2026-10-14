import { performance } from "node:perf_hooks";
import type {
  AIProvider,
  BenchmarkCandidateResult,
  ModelDType,
} from "@apipilot/shared-domain";
import type { BenchmarkWorkload } from "./workloads";

/** One model at one weight quantization: the unit the benchmark compares (specs/013 T026). */
export interface BenchmarkCandidate {
  modelId: string;
  /**
   * ONNX weight quantization the candidate is loaded with. Always stated, never left to the
   * runtime's default, so a result says exactly what it measured and the same model can be compared
   * at two dtypes (fp32 against q8) reproducibly rather than anecdotally.
   */
  dtype: ModelDType;
}

/**
 * Runs every workload against `provider` and scores it. A workload counts as a success only when
 * the provider answered and the workload's own `isUsable` accepts the reply; a provider error is a
 * failure, not an exclusion. `readMemoryMb` is injectable so the measurement is testable.
 */
export async function evaluateCandidate(
  candidate: BenchmarkCandidate,
  provider: AIProvider,
  workloads: readonly BenchmarkWorkload[],
  readMemoryMb: () => number = () => process.memoryUsage().rss / (1024 * 1024),
): Promise<BenchmarkCandidateResult> {
  let successCount = 0;
  let totalLatencyMs = 0;
  let peakMemoryMb = 0;

  for (const workload of workloads) {
    const startedAt = performance.now();
    const response = await provider.infer({
      contractVersion: 1,
      requestId: `benchmark-${candidate.modelId}-${candidate.dtype}-${workload.id}`,
      input: workload.input,
      expectedOutputFormat: workload.expectedOutputFormat,
      ...(workload.maxOutputTokens !== undefined
        ? { maxOutputTokens: workload.maxOutputTokens }
        : {}),
    });
    totalLatencyMs += performance.now() - startedAt;
    peakMemoryMb = Math.max(peakMemoryMb, readMemoryMb());

    if (response.status === "success" && workload.isUsable(response.content)) {
      successCount += 1;
    }
  }

  return {
    modelId: candidate.modelId,
    dtype: candidate.dtype,
    structuredOutputSuccessRate: successCount / workloads.length,
    averageLatencyMs: totalLatencyMs / workloads.length,
    peakMemoryMb,
  };
}

/**
 * Picks the evidence-best result: highest success rate, then lowest latency (constitution VII).
 * The rationale names the dtype, because the same model can appear at several.
 */
export function selectBest(candidates: readonly BenchmarkCandidateResult[]): {
  modelId: string;
  dtype: ModelDType | undefined;
  rationale: string;
} {
  if (candidates.length === 0) {
    throw new Error("No candidate was evaluated, so none can be selected");
  }
  const ranked = [...candidates].sort((a, b) =>
    b.structuredOutputSuccessRate !== a.structuredOutputSuccessRate
      ? b.structuredOutputSuccessRate - a.structuredOutputSuccessRate
      : a.averageLatencyMs - b.averageLatencyMs,
  );
  const winner = ranked[0];
  return {
    modelId: winner.modelId,
    dtype: winner.dtype,
    rationale:
      `${winner.modelId} (dtype=${winner.dtype ?? "default"}) had the highest structured-output ` +
      `success rate (${(winner.structuredOutputSuccessRate * 100).toFixed(0)}%) on the enhancement ` +
      `workloads, with average latency ${winner.averageLatencyMs.toFixed(0)}ms ` +
      "(research.md #2, constitution VII and XXII).",
  };
}
