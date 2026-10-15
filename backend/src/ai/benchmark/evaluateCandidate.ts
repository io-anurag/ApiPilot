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

/** Tiny prompt used to load the model before timing starts; its reply is never scored. */
export const WARMUP_INPUT = "ping";

/**
 * Loads the model with a one-token warm-up, then runs every workload against `provider` and scores
 * it. A workload counts as a success only when the provider answered and the workload's own
 * `isUsable` accepts the reply; a provider error is a failure, not an exclusion. The warm-up exists
 * because the first request otherwise pays the whole model load (minutes for a large model), which
 * made latencies incomparable across candidates; its duration is reported as `loadMs`. A failing
 * warm-up throws, since a model that cannot load has nothing to compare. `readMemoryMb` and
 * `now` are injectable so the measurement is testable.
 */
export async function evaluateCandidate(
  candidate: BenchmarkCandidate,
  provider: AIProvider,
  workloads: readonly BenchmarkWorkload[],
  readMemoryMb: () => number = () => process.memoryUsage().rss / (1024 * 1024),
  now: () => number = () => performance.now(),
): Promise<BenchmarkCandidateResult> {
  const warmupStartedAt = now();
  const warmup = await provider.infer({
    contractVersion: 1,
    requestId: `benchmark-${candidate.modelId}-${candidate.dtype}-warmup`,
    input: WARMUP_INPUT,
    expectedOutputFormat: "text",
    maxOutputTokens: 1,
  });
  const loadMs = now() - warmupStartedAt;
  if (warmup.status !== "success") {
    throw new Error(
      `Warm-up failed (${warmup.errorCategory ?? "unknown"}): ${warmup.errorMessage ?? "no message"}`,
    );
  }

  let successCount = 0;
  let totalLatencyMs = 0;
  let totalOutputChars = 0;
  let peakMemoryMb = readMemoryMb();

  for (const workload of workloads) {
    const startedAt = now();
    const response = await provider.infer({
      contractVersion: 1,
      requestId: `benchmark-${candidate.modelId}-${candidate.dtype}-${workload.id}`,
      input: workload.input,
      expectedOutputFormat: workload.expectedOutputFormat,
      ...(workload.maxOutputTokens !== undefined
        ? { maxOutputTokens: workload.maxOutputTokens }
        : {}),
    });
    totalLatencyMs += now() - startedAt;
    totalOutputChars += response.content?.length ?? 0;
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
    loadMs,
    averageOutputChars: totalOutputChars / workloads.length,
    peakMemoryMb,
  };
}

/**
 * Picks the evidence-best result: highest success rate, then lowest latency (constitution VII). The
 * rationale names the dtype, because the same model can appear at several.
 *
 * When no candidate produced a usable reply on any workload, nothing qualifies: ranking zeros by
 * latency would "select" whichever model failed fastest. The result is then `qualified: false`, the
 * configured model (`retainedModelId`) is kept when it was evaluated, and the rationale says it is a
 * retention, not an endorsement. No minimum rate above zero is imposed, as none is specified.
 */
export function selectBest(
  candidates: readonly BenchmarkCandidateResult[],
  retainedModelId?: string,
): {
  modelId: string;
  dtype: ModelDType | undefined;
  qualified: boolean;
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
  const best = ranked[0];
  if (best.structuredOutputSuccessRate === 0) {
    const retained = candidates.find((c) => c.modelId === retainedModelId);
    const kept = retained ?? best;
    return {
      modelId: kept.modelId,
      dtype: retained?.dtype ?? best.dtype,
      qualified: false,
      rationale:
        "No candidate produced a usable reply on any enhancement workload, so none qualifies on " +
        `evidence. ${kept.modelId} is retained as the configured model; this is not an endorsement ` +
        "(research.md #2, constitution VII and XXII).",
    };
  }
  return {
    modelId: best.modelId,
    dtype: best.dtype,
    qualified: true,
    rationale:
      `${best.modelId} (dtype=${best.dtype ?? "default"}) had the highest structured-output ` +
      `success rate (${(best.structuredOutputSuccessRate * 100).toFixed(0)}%) on the enhancement ` +
      `workloads, with average latency ${best.averageLatencyMs.toFixed(0)}ms ` +
      "(research.md #2, constitution VII and XXII).",
  };
}
