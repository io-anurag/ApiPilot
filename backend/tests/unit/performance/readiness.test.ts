import { describe, expect, it } from "vitest";
import { createK6Probe, interpretProbe } from "../../../src/performance/k6/readiness";

/** FR-027, SC-012 (research D9, tasks T055). */

const AT = "2026-09-27T12:00:00.000Z";

function fakeExec(result: { error?: NodeJS.ErrnoException; stdout?: string }) {
  const calls: { file: string; args: string[]; options: Record<string, unknown> }[] = [];
  const execFile = (file: string, args: string[], options: Record<string, unknown>, callback: (e: unknown, out: string, err: string) => void) => {
    calls.push({ file, args, options });
    callback(result.error ?? null, result.stdout ?? "", "");
  };
  return { calls, execFile };
}

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("k6 readiness", () => {
  it("reads the version and requires at least 1.0.0", () => {
    expect(interpretProbe(null, "k6 v1.2.3 (commit/abc, go1.22, linux/amd64)\n", AT)).toEqual({ state: "ready", version: "1.2.3", checkedAt: AT });
    expect(interpretProbe(null, "k6 v1.0.0\n", AT)).toMatchObject({ state: "ready", version: "1.0.0" });
    expect(interpretProbe(null, "k6 v0.49.0\n", AT)).toEqual({ state: "unavailable", reason: "unsupported-version", detail: "found 0.49.0, need ≥ 1.0.0", checkedAt: AT });
  });

  it("names why k6 is unavailable", () => {
    expect(interpretProbe(null, "something else", AT)).toMatchObject({ reason: "version-unreadable" });
    expect(interpretProbe(errno("ENOENT"), "", AT)).toMatchObject({ reason: "not-found" });
    expect(interpretProbe(errno("EACCES"), "", AT)).toMatchObject({ reason: "not-executable" });
  });

  it("runs `version` with no shell and a 5-second timeout, preferring K6_BINARY_PATH", async () => {
    const exec = fakeExec({ stdout: "k6 v1.1.0" });
    const probe = createK6Probe({ execFile: exec.execFile as never, env: { K6_BINARY_PATH: "/opt/k6" }, platform: "linux", now: () => new Date(AT) });
    const result = await probe({ recheck: true });
    expect(exec.calls).toEqual([{ file: "/opt/k6", args: ["version"], options: { timeout: 5000, shell: false, windowsHide: true } }]);
    expect(result).toEqual({ readiness: { state: "ready", version: "1.1.0", checkedAt: AT }, binaryPath: "/opt/k6" });
  });

  it("looks up k6.exe on PATH on Windows, and never puts the path in the readiness", async () => {
    const exec = fakeExec({ error: errno("ENOENT") });
    const probe = createK6Probe({ execFile: exec.execFile as never, env: {}, platform: "win32", now: () => new Date(AT) });
    const result = await probe({ recheck: false });
    expect(exec.calls[0].file).toBe("k6.exe");
    expect(result.binaryPath).toBeUndefined();
    expect(JSON.stringify(result.readiness)).not.toContain("k6.exe");
  });

  it("caches briefly, and a recheck always probes again", async () => {
    const exec = fakeExec({ stdout: "k6 v1.1.0" });
    let now = Date.parse(AT);
    const probe = createK6Probe({ execFile: exec.execFile as never, env: {}, platform: "linux", now: () => new Date(now) });
    await probe({ recheck: false });
    await probe({ recheck: false });
    expect(exec.calls).toHaveLength(1);
    await probe({ recheck: true });
    expect(exec.calls).toHaveLength(2);
    now += 31_000;
    await probe({ recheck: false });
    expect(exec.calls).toHaveLength(3);
  });
});
