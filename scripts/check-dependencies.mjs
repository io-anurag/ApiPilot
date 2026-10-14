#!/usr/bin/env node
// Pre-flight guard: fails with an actionable message when the workspace dependencies have not been
// installed, instead of the raw shell "'vitest' is not recognized" / "command not found" error.
// Wired into the root `pretest`, `prelint`, `prebuild` and `predev` scripts. It only checks that
// each root devDependency resolves under node_modules; it never installs anything.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf-8"));

const missing = Object.keys(manifest.devDependencies ?? {}).filter(
  (name) => !existsSync(path.join(rootDir, "node_modules", name, "package.json")),
);

if (missing.length > 0) {
  console.error(
    [
      "ApiPilot dependencies are not installed.",
      `Missing: ${missing.join(", ")}`,
      "Run `npm install` from the repository root, then retry.",
    ].join("\n"),
  );
  process.exit(1);
}
