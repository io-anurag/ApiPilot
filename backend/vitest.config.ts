import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "backend",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup/sessionTestContext.ts", "./tests/setup/testDb.ts"],
    // newman@6.2.2 (latest) reads every `fs` property when it loads, which on Node 24 emits
    // DEP0176 (`fs.F_OK`) once per worker. Only that code is silenced; the backend's dev/start
    // scripts pass the same flag. Remove once newman stops touching the deprecated constants.
    execArgv: ["--disable-warning=DEP0176"],
  },
});
