import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildUserScriptChildEnv, buildUserScriptK6Args } from "../../../../src/performance/k6/runner";

/**
 * AP-034 research R10, R11; SC-007 (tasks T022, T047). A reviewed contract: changing either list is
 * a change to what ApiPilot executes for a user-supplied script. Update research R10 first.
 */
const RUN_DIR = path.join("tmp", "apipilot-k6", "run-1");

const PINNED = [
  "run",
  "--no-usage-report",
  "--quiet",
  "--no-color",
  "--log-format",
  "json",
  "--system-tags",
  "proto,subproto,status,method,url,name,group,check,error,error_code,tls_version,scenario,service,expected_response,ip",
  "--out",
  `json=${path.join(RUN_DIR, "metrics.ndjson")}`,
];

describe("buildUserScriptK6Args", () => {
  it("is the pinned list for the script's own load", () => {
    expect(buildUserScriptK6Args(RUN_DIR, null)).toEqual([...PINNED, path.join(RUN_DIR, "script.js")]);
  });

  it("never passes a summary, cloud or remote-output option", () => {
    const args = buildUserScriptK6Args(RUN_DIR, null).join(" ");
    for (const forbidden of ["--summary-export", "--summary-mode", "--no-summary", "cloud", "--log-output", "experimental-prometheus", "influxdb"]) {
      expect(args).not.toContain(forbidden);
    }
  });

  it("appends one --stage per stage, in order, before the script path (FR-027)", () => {
    expect(
      buildUserScriptK6Args(RUN_DIR, [
        { durationMs: 30_000, targetVirtualUsers: 5 },
        { durationMs: 60_000, targetVirtualUsers: 10 },
        { durationMs: 10_000, targetVirtualUsers: 0 },
      ]),
    ).toEqual([...PINNED, "--stage", "30s:5", "--stage", "60s:10", "--stage", "10s:0", path.join(RUN_DIR, "script.js")]);
  });
});

describe("buildUserScriptChildEnv", () => {
  const processEnv = {
    Path: "C:\\k6",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\t",
    TMP: "C:\\t",
    HOME: "/home/x",
    TMPDIR: "/tmp",
    K6_OUT: "cloud",
    K6_CLOUD_TOKEN: "token",
    APIPILOT_V_0: "leak",
    DATABASE_PASSWORD: "backend-secret",
  };

  it("keeps only the start-up variables of the backend's environment (SC-007)", () => {
    expect(buildUserScriptChildEnv(processEnv, {}, "win32")).toEqual({ Path: "C:\\k6", SystemRoot: "C:\\Windows", TEMP: "C:\\t", TMP: "C:\\t" });
    expect(buildUserScriptChildEnv(processEnv, {}, "linux")).toEqual({ Path: "C:\\k6", HOME: "/home/x", TMPDIR: "/tmp" });
  });

  it("adds each mapped name with its value, and refuses k6 options and start-up names", () => {
    const env = buildUserScriptChildEnv(processEnv, { BASE_URL: "http://127.0.0.1:4600", API_KEY: "k", K6_OUT: "cloud", path: "x", "A-B": "y" }, "win32");
    expect(env.BASE_URL).toBe("http://127.0.0.1:4600");
    expect(env.API_KEY).toBe("k");
    expect(env.K6_OUT).toBeUndefined();
    expect(env.path).toBeUndefined();
    expect(env["A-B"]).toBeUndefined();
    expect(env.Path).toBe("C:\\k6");
  });

  it("never puts a value in the argument list", () => {
    expect(buildUserScriptK6Args(RUN_DIR, null).join(" ")).not.toContain("http://127.0.0.1:4600");
  });
});
