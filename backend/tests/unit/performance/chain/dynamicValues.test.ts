import { describe, expect, it } from "vitest";
import { SUPPORTED_DYNAMIC_VARIABLES } from "@apipilot/shared-domain";
import { CHAIN_RUNTIME } from "../../../../src/performance/k6/renderChainScript";

/** AP-037 FR-048: every supported dynamic variable has a deterministic generator in the chain runtime. */

type Generate = (name: string) => string;

/**
 * Runs the part of the fixed runtime that generates values, with k6's globals supplied by the test.
 * The slice ends where the runtime starts reading data-set rows, so no k6 module is needed.
 */
function generator(kind: string, vu: number, iteration: number, runTag = ""): Generate {
  const source = CHAIN_RUNTIME.slice(CHAIN_RUNTIME.indexOf("const RUN_TAG_SETTING"), CHAIN_RUNTIME.indexOf("function take"));
  const factory = new Function(
    "__ENV",
    "__VU",
    "__ITER",
    "DYNAMIC",
    "SETUP_STEPS",
    "DATA_SETS",
    "VALUE_ENV",
    `${source}\nreturn dynamicValue;`,
  ) as (...args: unknown[]) => Generate;
  return factory({ APIPILOT_RUN_TAG: runTag }, vu, iteration, { apipilot_dyn_0: { kind } }, [], [], {});
}

const valueOf = (kind: string, vu = 3, iteration = 7, runTag = "") => generator(kind, vu, iteration, runTag)("apipilot_dyn_0");

describe("chain runtime dynamic values", () => {
  it("generates a non-empty, reference-free value for every supported variable", () => {
    for (const kind of SUPPORTED_DYNAMIC_VARIABLES) {
      const value = valueOf(kind);
      expect(value, kind).not.toBe("");
      expect(value, kind).not.toContain("{{");
    }
  });

  it("is deterministic for the same virtual user, iteration and occurrence", () => {
    const clockFree = [...SUPPORTED_DYNAMIC_VARIABLES].filter((kind) => !["$timestamp", "$isoTimestamp", "$randomDateFuture", "$randomDatePast", "$randomDateRecent"].includes(kind));
    for (const kind of clockFree) expect(valueOf(kind, 5, 9, "a1b2c3"), kind).toBe(valueOf(kind, 5, 9, "a1b2c3"));
  });

  it("keeps unique values unique across virtual users, iterations and occurrences", () => {
    for (const kind of ["$guid", "$randomEmail", "$randomExampleEmail", "$randomUserName"]) {
      const seen = new Set<string>();
      for (let vu = 1; vu <= 5; vu += 1) for (let iteration = 0; iteration < 5; iteration += 1) seen.add(valueOf(kind, vu, iteration));
      expect(seen.size, kind).toBe(25);
    }
    const run = generator("$randomEmail", 1, 1);
    expect(run("apipilot_dyn_0")).toBe(run("apipilot_dyn_0"));
  });

  it("produces the documented shapes", () => {
    expect(valueOf("$randomHexColor")).toMatch(/^#[0-9a-f]{6}$/);
    expect(valueOf("$randomIP")).toMatch(/^(?:\d{1,3}\.){3}\d{1,3}$/);
    expect(valueOf("$randomIPV6")).toMatch(/^(?:[0-9a-f]{4}:){7}[0-9a-f]{4}$/);
    expect(valueOf("$randomMACAddress")).toMatch(/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/);
    expect(valueOf("$randomPassword")).toMatch(/^[0-9a-z]{15}$/);
    expect(valueOf("$randomSemver")).toMatch(/^\d\.\d\.\d$/);
    expect(valueOf("$randomCountryCode")).toMatch(/^[A-Z]{2}$/);
    expect(valueOf("$randomPhoneNumberExt")).toMatch(/^\d{3}-\d{3}-\d{4}x\d{3,4}$/);
    expect(valueOf("$randomStreetAddress")).toMatch(/^\d+ \S+ \S+$/);
    expect(valueOf("$randomUrl")).toMatch(/^https?:\/\/[a-z]+\.[a-z]+$/);
    expect(valueOf("$randomExampleEmail")).toMatch(/@example\.(?:com|net|org)$/);
    expect(valueOf("$randomJobTitle").split(" ")).toHaveLength(3);
  });

  it("keeps coordinates in range and dates on the right side of now", () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const latitude = Number(valueOf("$randomLatitude", 1, iteration));
      const longitude = Number(valueOf("$randomLongitude", 1, iteration));
      expect(latitude).toBeGreaterThanOrEqual(-90);
      expect(latitude).toBeLessThanOrEqual(90);
      expect(longitude).toBeGreaterThanOrEqual(-180);
      expect(longitude).toBeLessThanOrEqual(180);
    }
    const now = Date.now();
    expect(Date.parse(valueOf("$randomDateFuture"))).toBeGreaterThan(now);
    expect(Date.parse(valueOf("$randomDatePast"))).toBeLessThan(now);
    const recent = Date.parse(valueOf("$randomDateRecent"));
    expect(recent).toBeLessThanOrEqual(Date.now());
    expect(recent).toBeGreaterThan(now - 86_400_000 - 1000);
  });
});
