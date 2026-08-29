import type { BenchmarkCandidateResult, BenchmarkReport } from "@apipilot/shared-domain";

/**
 * Builds and validates a BenchmarkReport (FR-015). Throws if `selectedModelId` does not
 * match one of the evaluated `candidates` (data-model.md Validation Rules) — a selection
 * MUST always be backed by a recorded, evaluated candidate.
 */
export function buildBenchmarkReport(params: {
  workloadSetId: string;
  candidates: BenchmarkCandidateResult[];
  selectedModelId: string;
  selectionRationale: string;
  runAt?: Date;
}): BenchmarkReport {
  const selectedIsCandidate = params.candidates.some(
    (candidate) => candidate.modelId === params.selectedModelId,
  );
  if (!selectedIsCandidate) {
    throw new Error(
      `selectedModelId "${params.selectedModelId}" must match the modelId of one evaluated candidate`,
    );
  }

  return {
    runAt: (params.runAt ?? new Date()).toISOString(),
    workloadSetId: params.workloadSetId,
    candidates: params.candidates,
    selectedModelId: params.selectedModelId,
    selectionRationale: params.selectionRationale,
  };
}
