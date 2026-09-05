import { Router } from "express";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVersionInfo } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

const logger = createLogger("api.version");

/** Build/version metadata endpoint; reports the package version and git commit, each falling back to "unknown" when unavailable. */
export const versionRouter = Router();

const here = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  try {
    const pkgPath = path.resolve(here, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// No CI-injected build metadata exists yet, so this falls back to the working tree's own git
// commit; a bare/deployed copy without a `.git` directory (or without git installed) reports
// "unknown" rather than failing the request.
function readGitCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    // execFileSync (no shell) with a fixed argv — nothing here is attacker-influenced input, so
    // this only resolves "git" itself off PATH, same as any other locally invoked dev tooling.
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: here,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const APP_VERSION = readPackageVersion();
const APP_COMMIT = readGitCommit();

versionRouter.get("/version", (req, res) => {
  const startedAt = Date.now();
  logger.info("request_received", { method: req.method, path: req.path });
  res.status(200).json(createVersionInfo(APP_VERSION, APP_COMMIT));
  logger.info("request_succeeded", {
    method: req.method,
    path: req.path,
    statusCode: 200,
    durationMs: Date.now() - startedAt,
  });
});
