/** A representative sample generation workload used by the benchmarking harness. */
export interface BenchmarkWorkload {
  id: string;
  input: string;
  expectedOutputFormat: "text" | "json";
}

/**
 * Identifies this representative sample set (data-model.md `BenchmarkReport.workloadSetId`).
 * These workloads are generic, structured/JSON-shaped generation prompts representative of
 * future AI-enhanced features (e.g., AP-005) — they intentionally contain no OpenAPI-specific
 * business logic (FR-012, research.md #2).
 */
export const WORKLOAD_SET_ID = "ap004-representative-v1";

export const SAMPLE_WORKLOADS: BenchmarkWorkload[] = [
  {
    id: "structured-list",
    input:
      'Return only a JSON array of exactly three short example string values, e.g. ["a","b","c"].',
    expectedOutputFormat: "json",
  },
  {
    id: "structured-object",
    input:
      'Return only a JSON object with exactly the keys "name" (a string) and "count" (a number).',
    expectedOutputFormat: "json",
  },
  {
    id: "short-explanation",
    input: "In one short sentence, explain why input validation matters for a web API.",
    expectedOutputFormat: "text",
  },
];
