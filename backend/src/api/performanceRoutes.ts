import type { K6Probe, PerformanceRunner } from "../performance/k6/runnerTypes";

/**
 * What the performance routes need from their environment: the k6 runner and probe, the progress
 * tick, the clock and the run directory root. Request-chain plans (`chainPlans.ts`) use them; the
 * legacy run routes read stored runs only (specs/037-request-chain-performance FR-037).
 */
export interface PerformanceTestingDependencies {
  runner: PerformanceRunner;
  probe: K6Probe;
  /** How often a running test checkpoints progress and keeps its session alive (AP-029 research D18). */
  tickIntervalMs: number;
  now: () => Date;
  runDirectoryRoot?: string;
}
