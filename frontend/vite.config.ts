import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createFileLogger } from "./viteLogger.ts";
import { apiProxyOptions } from "./devAccess/apiProxy.ts";
import { devAccessPlugin } from "./devAccess/devAccessPlugin.ts";
import { resolveListenAddress } from "./devAccess/listenAddress.ts";

// The ports live in the repository-root `.env`, which the backend loads (backend/src/loadEnv.ts)
// but Vite does not: Vite never copies `.env` into `process.env`, and its own env directory is
// `frontend/`. Read the root file explicitly so the dev proxy follows BACKEND_PORT; a value set in
// the shell still wins, as it does for the backend's dotenv.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, "");
  const backendPort = process.env.BACKEND_PORT ?? rootEnv.BACKEND_PORT ?? "4000";
  const frontendDevPort = Number.parseInt(
    process.env.FRONTEND_DEV_PORT ?? rootEnv.FRONTEND_DEV_PORT ?? "5173",
    10,
  );
  // Loopback unless FRONTEND_DEV_HOST says otherwise (specs/049-lan-dev-access-token). Any other
  // address turns on the access-token guard below; there is no setting to turn it off, and an
  // invalid value throws here so the dev server refuses to start.
  const listenAddress = resolveListenAddress(
    process.env.FRONTEND_DEV_HOST ?? rootEnv.FRONTEND_DEV_HOST,
  );

  return {
    customLogger: createFileLogger(),
    plugins: [
      react(),
      tailwindcss(),
      ...(listenAddress.protected ? [devAccessPlugin({ backendPort, address: listenAddress })] : []),
    ],
    server: {
      // Loopback by default. `host: true` would expose the dev server on every interface, and
      // because its proxy reaches the backend over loopback it would hand LAN clients a way around
      // the backend's loopback bind. A non-loopback FRONTEND_DEV_HOST is allowed only together
      // with the per-launch access token (devAccessPlugin), which gates the proxy as well.
      host: listenAddress.host,
      port: frontendDevPort,
      proxy: {
        "/api": apiProxyOptions(backendPort),
      },
    },
    test: {
      name: "frontend",
      environment: "jsdom",
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
      setupFiles: ["./tests/setup.ts"],
    },
  };
});
