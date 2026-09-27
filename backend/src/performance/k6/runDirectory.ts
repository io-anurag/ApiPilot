import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Per-run working directories for k6 (specs/031-k6-performance-testing research D22). Each run
 * gets `os.tmpdir()/apipilot-k6/<runId>`, created owner-only where the platform supports it, and
 * removed when the run settles and at startup. No setting chooses another location.
 */
export function runDirectoryRoot(): string {
  return path.join(tmpdir(), "apipilot-k6");
}

const RUN_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function runDirectoryPath(runId: string, root: string): string {
  // Run ids are server-generated UUIDs; the check keeps a malformed id from naming another path.
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Invalid run id for a run directory.");
  return path.join(root, runId);
}

export function createRunDirectory(runId: string, root: string = runDirectoryRoot()): string {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = runDirectoryPath(runId, root);
  mkdirSync(dir, { mode: 0o700 });
  return dir;
}

export function removeRunDirectory(runId: string, root: string = runDirectoryRoot()): void {
  rmSync(runDirectoryPath(runId, root), { recursive: true, force: true });
}

/** Removes every run directory a prior process left behind. Returns how many were removed. */
export function removeLeftoverRunDirectories(root: string = runDirectoryRoot()): number {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!RUN_ID_PATTERN.test(entry)) continue;
    rmSync(path.join(root, entry), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
