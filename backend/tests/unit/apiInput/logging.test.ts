import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logInputEvent } from "../../../src/apiInput/logging";

function captured(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

describe("logInputEvent (constitution XX, specs/056 R26)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs identifiers and numbers as given", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logInputEvent("har_analyzed", { format: "har", total: 12, imported: 7, excluded: 4, malformed: 1, operations: 3, durationMs: 41 });
    expect(captured(spy)[0]).toMatchObject({
      component: "apiInput", event: "har_analyzed", format: "har", total: 12, imported: 7, excluded: 4, malformed: 1, operations: 3, durationMs: 41,
    });
  });

  it("replaces any string that is not a short identifier, so content cannot reach a log line", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logInputEvent("input_rejected", {
      errorCategory: "https://user:SEEDED-SECRET-PW@host/path?token=SEEDED-SECRET-TOKEN",
      limit: "x".repeat(200),
    });
    const [entry] = captured(spy);
    expect(entry.errorCategory).toBe("invalid");
    expect(entry.limit).toBe("invalid");
    expect(JSON.stringify(entry)).not.toContain("SEEDED-SECRET");
  });

  it("keeps a normal error class name and limit name", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logInputEvent("input_rejected", { errorCategory: "InputLimitExceededError", limit: "INPUT_HAR_MAX_ENTRIES" });
    expect(captured(spy)[0]).toMatchObject({ errorCategory: "InputLimitExceededError", limit: "INPUT_HAR_MAX_ENTRIES" });
  });

  it("turns a non-finite number into -1 rather than logging it raw", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logInputEvent("definition_validated", { problemCount: Number.NaN });
    expect(captured(spy)[0].problemCount).toBe(-1);
  });
});

describe("the input layer logs only through logInputEvent", () => {
  const root = path.resolve(__dirname, "../../../src/apiInput");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? files(full) : full.endsWith(".ts") ? [full] : [];
    });

  it("has no direct logger use outside logging.ts", () => {
    for (const file of files(root)) {
      if (path.basename(file) === "logging.ts") continue;
      const source = readFileSync(file, "utf-8");
      expect(source, path.relative(root, file)).not.toMatch(/createLogger/);
      expect(source, path.relative(root, file)).not.toMatch(/console\./);
    }
  });
});
