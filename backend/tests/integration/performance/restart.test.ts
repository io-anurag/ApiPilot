import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { createRunDirectory, removeRunDirectory } from "../../../src/performance/k6/runDirectory";
import { recoverPerformanceRunsAtStartup } from "../../../src/performance/startup";
import { runFixture } from "../../fixtures/performance/builders";

/** AP-029 FR-032, SC-006 (specs/031-k6-performance-testing tasks T016). */

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("performance runs at backend startup", () => {
  it("records a run left in progress as cancelled for backend-restart, and starts nothing", () => {
    root = mkdtempSync(path.join(tmpdir(), "apipilot-k6-test-"));
    const repo = getPerformanceRunRepository();
    repo.create("session-restart", runFixture({ id: "interrupted" }));

    recoverPerformanceRunsAtStartup(root);

    const run = repo.get("session-restart", "interrupted");
    expect(run).toMatchObject({ status: "cancelled", cancelReason: "backend-restart" });
    expect(run?.endedAt).toBeDefined();
    expect(repo.getInProgress("session-restart")).toBeUndefined();
  });

  it("removes run directories a prior process left behind, and nothing else", () => {
    root = mkdtempSync(path.join(tmpdir(), "apipilot-k6-test-"));
    const leftover = createRunDirectory("11111111-2222-4333-8444-555555555555", root);
    writeFileSync(path.join(leftover, "metrics.ndjson"), "{}\n");
    const unrelated = path.join(root, "not a run dir");
    mkdirSync(unrelated);

    recoverPerformanceRunsAtStartup(root);

    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("creates run directories owner-only where the platform supports modes, and removes them", () => {
    root = mkdtempSync(path.join(tmpdir(), "apipilot-k6-test-"));
    const dir = createRunDirectory("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", root);
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
    removeRunDirectory("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", root);
    expect(existsSync(dir)).toBe(false);
    expect(() => createRunDirectory("../escape", root!)).toThrow();
  });
});
