import { createLogger } from "../logger";
import { getPerformanceRunRepository } from "../persistence/performanceRunRepository";
import { removeLeftoverRunDirectories } from "./k6/runDirectory";

const logger = createLogger("performanceStartup");

/**
 * Called once from `server.ts` before the listener starts (FR-032, research D18). A run a prior
 * process left in progress is recorded as cancelled for `backend-restart` and is never started
 * again; leftover k6 run directories are removed.
 */
export function recoverPerformanceRunsAtStartup(runDirectoryRoot?: string): void {
  const cancelled = getPerformanceRunRepository().markInterruptedRunsCancelled();
  const removedDirectories = removeLeftoverRunDirectories(runDirectoryRoot);
  if (cancelled > 0 || removedDirectories > 0) {
    logger.info("performance_startup_recovery", { cancelledRuns: cancelled, removedDirectories });
  }
}
