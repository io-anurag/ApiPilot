import { describe, expect, it } from "vitest";
import type { UserScriptRun } from "@apipilot/shared-domain";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getUserScriptRepository, type StoredUserScriptSettings } from "../../../src/persistence/userScriptRepository";
import { getUserScriptRunRepository } from "../../../src/persistence/userScriptRunRepository";

/** AP-034 research R7 to R9 (tasks T010): user script and run storage. */

const SESSION = "11111111-1111-4111-8111-111111111111";
const MARKER = "MARKER-not-in-any-column-7f3a";
const SETTINGS: StoredUserScriptSettings = {
  mapping: [{ name: "BASE_URL", source: { kind: "base-url" } }],
  removedNames: [],
  load: { kind: "script" },
  thresholds: [],
};

function content(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

function seedScript(id = "s1", text = `// ${MARKER}\nexport default function () {}\n`) {
  getUserScriptRepository().create(SESSION, { id, name: "Orders", content: content(text), sha256: `sha-${id}`, settings: SETTINGS, at: "2026-10-01T10:00:00.000Z" });
}

function runFixture(id: string, status: UserScriptRun["status"] = "in-progress"): UserScriptRun {
  return {
    id,
    source: "user-script",
    status,
    environment: { id: "e1", name: "Local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    snapshot: { scriptId: "s1", scriptName: MARKER, scriptSha256: "sha-s1", load: { kind: "script" }, mapping: [], thresholds: [], hostsFound: [] },
    k6Version: "1.2.0",
    k6ExitCode: null,
    exitMeaning: null,
    plannedDurationMs: null,
    startedAt: "2026-10-01T10:00:00.000Z",
    cancelRequested: false,
  };
}

describe("user script repository", () => {
  it("round-trips every field and keeps the exact bytes, BOM and CRLF included", () => {
    const text = "﻿import http from \"k6/http\";\r\nexport default function () {}\r\n";
    seedScript("s1", text);
    const stored = getUserScriptRepository().get(SESSION, "s1")!;
    expect(stored.content.equals(content(text))).toBe(true);
    expect(stored).toMatchObject({ id: "s1", name: "Orders", sizeBytes: content(text).length, sha256: "sha-s1", confirmation: null, settings: SETTINGS });
    expect(getUserScriptRepository().listBySession(SESSION).map((meta) => meta.id)).toEqual(["s1"]);
    expect(getUserScriptRepository().hasAny(SESSION)).toBe(true);
    expect(getUserScriptRepository().hasAny("other")).toBe(false);
  });

  it("confirms only the stored SHA-256, keeps the confirmation on rename, and clears it on a content change", () => {
    seedScript();
    const repository = getUserScriptRepository();
    expect(repository.confirm(SESSION, "s1", "stale", ["https://a:443"], "2026-10-01T10:01:00.000Z")).toBe(false);
    expect(repository.get(SESSION, "s1")!.confirmation).toBeNull();

    expect(repository.confirm(SESSION, "s1", "sha-s1", ["https://a:443"], "2026-10-01T10:01:00.000Z")).toBe(true);
    expect(repository.get(SESSION, "s1")!.confirmation).toEqual({ sha256: "sha-s1", confirmedAt: "2026-10-01T10:01:00.000Z", hostsStated: ["https://a:443"] });

    repository.rename(SESSION, "s1", "Renamed", "2026-10-01T10:02:00.000Z");
    expect(repository.get(SESSION, "s1")!.confirmation?.sha256).toBe("sha-s1");

    repository.replaceContent(SESSION, "s1", content("export default function () { }\n"), "sha-v2", SETTINGS, "2026-10-01T10:03:00.000Z");
    const replaced = repository.get(SESSION, "s1")!;
    expect(replaced.sha256).toBe("sha-v2");
    expect(replaced.confirmation).toBeNull();
    expect(replaced.confirmedSha256).toBeNull();
  });

  it("stores the content and confirmed hosts encrypted", () => {
    seedScript();
    getUserScriptRepository().confirm(SESSION, "s1", "sha-s1", [`https://${MARKER}.test:443`], "2026-10-01T10:01:00.000Z");
    const rows = getSharedConnection().db.prepare("SELECT * FROM user_scripts").all() as Record<string, unknown>[];
    const raw = rows.map((row) => Object.values(row).map((value) => (Buffer.isBuffer(value) ? value.toString("latin1") : String(value))).join("|")).join("\n");
    expect(raw).not.toContain(MARKER);
    expect(raw).not.toContain(Buffer.from(MARKER).toString("base64").slice(0, 16));
  });
});

describe("user script run repository", () => {
  it("round-trips a run, encrypts its snapshot, result and k6 message, and keeps the message off summaries", () => {
    const repository = getUserScriptRunRepository();
    repository.create(SESSION, runFixture("r1"));
    expect(repository.getInProgress(SESSION)?.id).toBe("r1");
    repository.checkpoint(SESSION, "r1", { progress: { elapsedMs: 10, currentVirtualUsers: 1, requestsSoFar: 2, failuresSoFar: 0 } });
    const settled = repository.settle(
      SESSION,
      "r1",
      { status: "failed", failure: { category: "k6-exited-with-error", k6Message: `boom ${MARKER}` }, exitCode: 107, exitMeaning: "script-exception" },
      "2026-10-01T10:05:00.000Z",
    );
    expect(settled).toMatchObject({ status: "failed", k6ExitCode: 107, exitMeaning: "script-exception", failure: { category: "k6-exited-with-error", k6Message: `boom ${MARKER}` } });
    expect(settled.snapshot.scriptName).toBe(MARKER);
    const [summary] = repository.listBySession(SESSION);
    expect(summary.failure).toEqual({ category: "k6-exited-with-error" });
    expect(repository.listBySession(SESSION, "s1")).toHaveLength(1);
    expect(repository.listBySession(SESSION, "other")).toHaveLength(0);

    const rows = getSharedConnection().db.prepare("SELECT * FROM user_script_runs").all() as Record<string, unknown>[];
    const raw = rows.map((row) => Object.values(row).map((value) => (Buffer.isBuffer(value) ? value.toString("latin1") : String(value))).join("|")).join("\n");
    expect(raw).not.toContain(MARKER);
  });

  it("marks interrupted runs cancelled for a backend restart and handles cancel requests", () => {
    const repository = getUserScriptRunRepository();
    repository.create(SESSION, runFixture("r1"));
    expect(repository.isCancelRequested(SESSION, "r1")).toBe(false);
    expect(repository.requestCancel(SESSION, "r1").cancelRequested).toBe(true);
    expect(repository.markInterruptedRunsCancelled()).toBe(1);
    expect(repository.get(SESSION, "r1")).toMatchObject({ status: "cancelled", cancelReason: "backend-restart" });
    repository.deleteBySession(SESSION);
    expect(repository.listBySession(SESSION)).toEqual([]);
  });
});
