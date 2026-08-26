import { createApp } from "./app";
import { loadConfig } from "./config";

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
