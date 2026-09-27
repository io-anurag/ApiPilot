import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { buildChildEnv, buildK6Args, createK6Runner } from "../../../src/performance/k6/runner";
import type { RunnerStartInput } from "../../../src/performance/k6/runnerTypes";

/** research D7, D10, D19 (tasks T056, T059). */

describe("k6 invocation", () => {
  it("pins the argument list, with the usage report off and JSON output only (FR-033, D10)", () => {
    const runDir = path.join("tmp", "apipilot-k6", "run-1");
    expect(buildK6Args(runDir)).toEqual([
      "run",
      "--no-usage-report",
      "--quiet",
      "--no-color",
      "--out",
      `json=${path.join(runDir, "metrics.ndjson")}`,
      path.join(runDir, "script.js"),
    ]);
  });

  it("passes only PATH, the platform's temp and home variables, and the run's values (D7)", () => {
    const processEnv = { PATH: "/bin", HOME: "/home/u", TMPDIR: "/tmp", APIPILOT_TEST_BACKEND_ONLY: "x", APIPILOT_DB_PATH: "/secret.db", SystemRoot: "C:\\Windows" };
    expect(buildChildEnv(processEnv, { APIPILOT_V_0: "http://t", APIPILOT_V_1: "s3cret", NOT_A_VALUE: "y" }, "linux")).toEqual({
      PATH: "/bin",
      HOME: "/home/u",
      TMPDIR: "/tmp",
      APIPILOT_V_0: "http://t",
      APIPILOT_V_1: "s3cret",
    });
    expect(buildChildEnv({ Path: "C:\\bin", SystemRoot: "C:\\Windows", TEMP: "C:\\t", TMP: "C:\\t", HOME: "x" }, {}, "win32")).toEqual({
      Path: "C:\\bin",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\t",
      TMP: "C:\\t",
    });
  });

  it("never puts a value in the command line", () => {
    expect(buildK6Args("/run").join(" ")).not.toMatch(/APIPILOT_V_|s3cret|-e |--env/);
  });
});

class FakeChild extends EventEmitter {
  pid = 4242;
  stderr = new PassThrough();
  signals: string[] = [];
  kill(signal: string) {
    this.signals.push(signal);
    return true;
  }
}

function input(overrides: Partial<RunnerStartInput> = {}): RunnerStartInput & { lines: string[]; stderr: string[] } {
  const lines: string[] = [];
  const stderr: string[] = [];
  return {
    runDir: "/run",
    scriptPath: "/run/script.js",
    metricsPath: "/run/metrics.ndjson",
    binaryPath: "k6",
    env: { PATH: "/bin" },
    onLine: (line) => lines.push(line),
    onStderrLine: (line) => stderr.push(line),
    lines,
    stderr,
    ...overrides,
  };
}

describe("k6 runner", () => {
  it("spawns with no shell in the run directory and tails the metrics file across chunks", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    let file = "";
    const runner = createK6Runner({
      spawn: spawn as never,
      platform: "linux",
      pollIntervalMs: 5,
      readChunk: (_path, offset) => ({ text: file.slice(offset), bytes: Buffer.byteLength(file.slice(offset)) }),
    });
    const start = input();
    const handle = runner.start(start);
    expect(spawn).toHaveBeenCalledWith("k6", buildK6Args("/run"), {
      shell: false,
      cwd: "/run",
      env: { PATH: "/bin" },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    file += '{"a":1}\n{"b"';
    await new Promise((resolve) => setTimeout(resolve, 20));
    file += ':2}\n{"c":3}';
    child.stderr.write("level=warn msg=something\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    child.emit("close", 0);
    expect(await handle.done).toEqual({ exitCode: 0, cancelled: false });
    expect(start.lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(start.stderr).toEqual(["level=warn msg=something"]);
  });

  it("cancels gracefully on POSIX, then forcibly after the grace period (D19)", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const runner = createK6Runner({ spawn: (() => child) as never, platform: "linux", readChunk: () => ({ text: "", bytes: 0 }) });
      const handle = runner.start(input());
      handle.cancel();
      handle.cancel();
      expect(child.signals).toEqual(["SIGINT"]);
      vi.advanceTimersByTime(5_000);
      expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
      child.emit("close", null);
      await vi.runOnlyPendingTimersAsync();
      expect(await handle.done).toEqual({ exitCode: null, cancelled: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the child tree with taskkill on Windows", () => {
    const child = new FakeChild();
    const execFile = vi.fn();
    const runner = createK6Runner({ spawn: (() => child) as never, execFile: execFile as never, platform: "win32", readChunk: () => ({ text: "", bytes: 0 }) });
    runner.start(input()).cancel();
    expect(execFile).toHaveBeenCalledWith("taskkill", ["/pid", "4242", "/T", "/F"], expect.any(Function));
    expect(child.signals).toEqual([]);
    child.emit("close", 1);
  });

  it("reports a binary that disappeared after the probe as a spawn error, without throwing", async () => {
    const child = new FakeChild();
    const runner = createK6Runner({ spawn: (() => child) as never, platform: "linux", readChunk: () => ({ text: "", bytes: 0 }) });
    const handle = runner.start(input());
    const error = Object.assign(new Error("spawn k6 ENOENT"), { code: "ENOENT" });
    child.emit("error", error);
    expect(await handle.done).toEqual({ exitCode: null, cancelled: false, spawnError: "not-found" });
    const denied = new FakeChild();
    const second = createK6Runner({ spawn: (() => denied) as never, platform: "linux", readChunk: () => ({ text: "", bytes: 0 }) }).start(input());
    denied.emit("error", Object.assign(new Error("EACCES"), { code: "EACCES" }));
    expect((await second.done).spawnError).toBe("not-executable");
  });
});
