import { createLogger } from "./logger";

/**
 * Captures failures no application `try`/`catch` ever observes — a truly uncaught exception or an
 * unhandled promise rejection — and routes each through the same structured logger the
 * service-client retrofit uses (FR-010a), so the "nothing is logged anywhere" gap (User Story 1)
 * is closed for crashes as well as already-caught errors.
 */

const logger = createLogger("globalErrorHandlers");

function messageFor(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "Unknown error";
}

/**
 * Installs the two global listeners and returns a function that removes them again — tests use
 * it to keep each install isolated; production code installs once at bootstrap and never needs
 * to call it.
 */
export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    logger.error("uncaught_exception", {
      message: event.message || messageFor(event.error),
      ...(event.filename ? { source: event.filename } : {}),
      ...(typeof event.lineno === "number" && event.lineno > 0 ? { lineno: event.lineno } : {}),
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    logger.error("unhandled_rejection", {
      message: messageFor(event.reason),
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
