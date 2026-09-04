import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const backendPort = process.env.BACKEND_PORT ?? "4000";
const frontendDevPort = Number.parseInt(process.env.FRONTEND_DEV_PORT ?? "5173", 10);

export default defineConfig({
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
});
