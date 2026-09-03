import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "backend",
      root: "./backend",
      environment: "node",
      include: ["tests/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "frontend",
      root: "./frontend",
      environment: "jsdom",
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
      setupFiles: ["./tests/setup.ts"],
    },
  },
  {
    test: {
      name: "shared-domain",
      root: "./packages/shared-domain",
      environment: "node",
      include: ["tests/**/*.test.ts"],
    },
  },
]);
