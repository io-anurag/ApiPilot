import "./loadEnv";
import { createApp } from "./app";
import { loadConfig, validateAIConfiguration } from "./config";
import { createLogger } from "./logger";
import { getSharedConnection } from "./persistence/connection";
import { PersistenceInitializationError } from "./persistence/errors";
import { getExecutionRunRepository } from "./persistence/executionRunRepository";
import { getUploadedCollectionRunRepository } from "./persistence/uploadedCollectionRunRepository";

const logger = createLogger("server");

/**
 * Last-resort guard (constitution XIX — Fail Safely). Node's default policy for an unhandled
 * rejection is to terminate the process; because a workflow lives only in memory, that discards
 * everything the user has built in their session — an uploaded specification, generated
 * scenarios, and every review decision made on them — with no way to recover it.
 *
 * Every route forwards its own errors to `app.ts`'s centralized handler, so reaching here means
 * a genuine escape rather than an expected failure: record it as such and keep serving. Only the
 * error's category is logged, never its message or stack (constitution XX).
 */
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    errorCategory: reason instanceof Error ? reason.name : typeof reason,
  });
});

const MIN_SUPPORTED_NODE_MAJOR = 20;
const currentMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (currentMajor < MIN_SUPPORTED_NODE_MAJOR) {
  logger.error("unsupported_node_version", {
    nodeVersion: process.versions.node,
    minimumMajor: MIN_SUPPORTED_NODE_MAJOR,
    remediation: "Upgrade Node.js (see .nvmrc) and retry.",
  });
  process.exit(1);
}

const config = loadConfig();
validateAIConfiguration();

// Opens (and, on first run, initializes) the local persistence layer before anything else
// starts, so a corrupted/unreadable database file fails startup explicitly rather than
// surfacing later as a confusing runtime error (specs/025-local-persistence-layer FR-007,
// research.md D9).
try {
  getSharedConnection();
} catch (err) {
  if (err instanceof PersistenceInitializationError) {
    // `reason` carries the error's own operator-facing guidance (database path plus underlying
    // cause). It is a local filesystem diagnostic, never spec content or a credential, and it is
    // written only to the server-side log — never returned to a client (constitution XX).
    logger.error("persistence_initialization_failed", {
      errorCategory: err.name,
      reason: err.message,
    });
    process.exit(1);
  }
  throw err;
}

// Any execution run left "in-progress" by a prior process (crash, restart, kill) settles as
// cancelled/"backend-restart" before the HTTP listener accepts requests, rather than being
// silently reported as successful or left in a permanently stuck state (FR-008).
getExecutionRunRepository().markInterruptedRunsCancelled();
// Same guard for an uploaded-collection run left "in-progress" by a prior process
// (specs/026-external-collection-execution, mirrors FR-008's rationale exactly).
getUploadedCollectionRunRepository().markInterruptedRunsCancelled();

const app = createApp(undefined, { debugLogRealClientIp: config.debugLogRealClientIp });

const server = app.listen(config.backendPort, () => {
  logger.info("server_listening", {
    port: config.backendPort,
    url: `http://localhost:${config.backendPort}`,
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error("server_start_failed", {
      errorCategory: "EADDRINUSE",
      port: config.backendPort,
      remediation: "Set BACKEND_PORT to a free port and retry.",
    });
  } else {
    logger.error("server_start_failed", {
      errorCategory: err.code ?? err.name,
      port: config.backendPort,
      reason: err.message,
    });
  }
  process.exit(1);
});
