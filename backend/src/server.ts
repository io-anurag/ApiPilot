import "./loadEnv";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";

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
  console.error(
    `Unsupported Node.js version v${process.versions.node}. ApiPilot requires Node.js ` +
      `${MIN_SUPPORTED_NODE_MAJOR}+ (see .nvmrc). Please upgrade and retry.`,
  );
  process.exit(1);
}

const config = loadConfig();
const app = createApp();

const server = app.listen(config.backendPort, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${config.backendPort}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${config.backendPort} is already in use. Set BACKEND_PORT to a free port and retry.`,
    );
  } else {
    console.error("Failed to start backend server:", err.message);
  }
  process.exit(1);
});
