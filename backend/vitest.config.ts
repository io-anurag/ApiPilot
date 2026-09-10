import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "backend",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup/sessionTestContext.ts"],
  },
});
