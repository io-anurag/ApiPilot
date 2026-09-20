/* eslint-env node */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: {
    node: true,
    es2022: true,
    browser: true,
  },
  ignorePatterns: [
    "**/dist/**",
    "**/build/**",
    "**/node_modules/**",
    "**/coverage/**",
    "*.config.*",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    // Application code logs through the structured loggers (backend/src/logger.ts and
    // frontend/src/logger.ts), so every line is one JSON object carrying a component, an event,
    // and non-sensitive fields only (constitution XX). A direct console call bypasses that
    // contract and, on the backend, the logs/backend.log file sink as well. The two logger
    // modules are the console sink itself and opt out with a local disable comment.
    "no-console": "error",
  },
};
