import { describe, expect, it } from "vitest";
import { checkUserScript } from "../../../../src/performance/userScript/checkUserScript";
import { parseK6Duration } from "../../../../src/performance/userScript/plannedDuration";

/** The planned length of a script's own load (live progress bar and time axis), read from literal options only. */

const script = (options: string) => Buffer.from(`import http from "k6/http";\n${options}\nexport default function () { http.get("https://example.test/"); }\n`);
const plannedOf = (options: string) => {
  const result = checkUserScript(script(options));
  if (!result.accepted) throw new Error(JSON.stringify(result.problems));
  return result.plannedDurationMs;
};

describe("parseK6Duration", () => {
  it("reads k6's duration text, with several parts and fractions", () => {
    expect(parseK6Duration("30s")).toBe(30_000);
    expect(parseK6Duration("1m30s")).toBe(90_000);
    expect(parseK6Duration("1h")).toBe(3_600_000);
    expect(parseK6Duration("1.5m")).toBe(90_000);
    expect(parseK6Duration("500ms")).toBe(500);
    expect(parseK6Duration(" 10s ")).toBe(10_000);
  });

  it("refuses anything else, so a plain number or odd text is not guessed", () => {
    for (const text of ["", "30", "s", "1d", "-5s", "1m 30s", "0s", "abc", "5 seconds"]) expect(parseK6Duration(text)).toBeNull();
  });
});

describe("plannedDurationMs of the script's own load", () => {
  it("is a literal duration", () => {
    expect(plannedOf(`export const options = { vus: 2, duration: "8s" };`)).toBe(8_000);
    expect(plannedOf(`export const options = { duration: "1m30s", thresholds: { http_req_duration: ["p(95)<500"] } };`)).toBe(90_000);
  });

  it("is the sum of literal stages", () => {
    expect(plannedOf(`export const options = { stages: [{ duration: "30s", target: 10 }, { duration: "1m", target: 10 }, { duration: "10s", target: 0 }] };`)).toBe(100_000);
  });

  it("is null when the script states no duration", () => {
    expect(plannedOf(`export const options = { vus: 1, thresholds: {} };`)).toBeNull();
    expect(plannedOf(`export const x = 1;`)).toBeNull();
  });

  it("is null when the answer would be a guess", () => {
    const guesses = [
      `export const options = { scenarios: { a: { executor: "constant-vus", vus: 1, duration: "10s" } } };`,
      `export const options = { duration: "10s", iterations: 5 };`,
      `export const options = { duration: "10s", stages: [{ duration: "5s", target: 1 }] };`,
      `const d = "10s"; export const options = { duration: d };`,
      "export const options = { duration: `${1}0s` };",
      `export const options = { duration: "10" };`,
      `export const options = { ...{ duration: "10s" } };`,
      `export const options = { stages: [{ duration: "5s", target: 1 }, { target: 2 }] };`,
      `export const options = { stages: [] };`,
      `export const options = { duration: "10s", gracefulStop: "1m" };`,
      `export const options = { ["duration"]: "10s" };`,
    ];
    for (const options of guesses) expect(plannedOf(options), options).toBeNull();
  });

  it("is null for an options object that is not a top-level exported literal", () => {
    expect(plannedOf(`const options = { duration: "10s" };`)).toBeNull();
    expect(plannedOf(`export const options = makeOptions();`)).toBeNull();
  });

  it("never runs the script to find out", () => {
    expect(plannedOf(`export const options = { duration: "10s" };\nthrow new Error("must not run");`)).toBe(10_000);
  });
});
