import { createLogger } from "../logger";
import { getPerformanceRunRepository } from "../persistence/performanceRunRepository";
import { getUserScriptRunRepository } from "../persistence/userScriptRunRepository";
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

/**
 * AP-034 (specs/034-run-user-k6-script FR-023, research R9): a user-script run a prior process left
 * in progress is recorded as cancelled for `backend-restart` and is never started again. Its run
 * directory is removed by `recoverPerformanceRunsAtStartup`, which shares the directory root.
 */
export function recoverUserScriptRunsAtStartup(): void {
  const cancelled = getUserScriptRunRepository().markInterruptedRunsCancelled();
  if (cancelled > 0) logger.info("user_script_startup_recovery", { cancelledRuns: cancelled });
}
