import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["backend", "frontend", "packages/shared-domain"],
  },
});
