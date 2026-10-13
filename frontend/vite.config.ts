import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createFileLogger } from "./viteLogger.ts";

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

  return {
    customLogger: createFileLogger(),
    plugins: [react(), tailwindcss()],
    server: {
      // Loopback only. `host: true` would expose the dev server on every interface, and because its
      // proxy reaches the backend over loopback it would hand LAN clients a way around the
      // backend's loopback bind.
      host: "127.0.0.1",
      port: frontendDevPort,
      proxy: {
        "/api": {
          // The backend binds 127.0.0.1 by default; `localhost` can resolve to ::1 first.
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          // Forward the original browser address via X-Forwarded-For. The backend ignores this
          // header unless DEBUG_LOG_REAL_CLIENT_IP=true explicitly opts in (see .env.example and
          // backend/src/app.ts), so this is inert by default.
          xfwd: true,
        },
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
