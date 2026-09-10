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
    port: frontendDevPort,
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
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
