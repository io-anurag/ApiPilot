import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createFileLogger } from "./viteLogger.ts";

const backendPort = process.env.BACKEND_PORT ?? "4000";
const frontendDevPort = Number.parseInt(process.env.FRONTEND_DEV_PORT ?? "5173", 10);

export default defineConfig({
  customLogger: createFileLogger(),
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: frontendDevPort,
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
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
});
