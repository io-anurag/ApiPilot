import { describe, expect, it } from "vitest";
import {
  compareCodeUnits,
  compareRequestSortKeys,
  requestSortKey,
  serializeArtifact,
  sortedEntries,
} from "../../../src/postman/ordering";

describe("compareCodeUnits", () => {
  it("orders by code unit rather than by locale", () => {
    // "B" (0x42) precedes "a" (0x61) by code unit, whereas locale collation generally puts
    // "a" first. Pinning the code-unit answer keeps output independent of the runtime's ICU
    // data (constitution XXIV).
    expect(compareCodeUnits("B", "a")).toBeLessThan(0);
    expect(compareCodeUnits("Z", "a")).toBeLessThan(0);
    expect(compareCodeUnits("_", "a")).toBeLessThan(0);
  });

  it("is symmetric and reports equality", () => {
    expect(compareCodeUnits("x", "x")).toBe(0);
    expect(compareCodeUnits("x", "y")).toBeLessThan(0);
    expect(compareCodeUnits("y", "x")).toBeGreaterThan(0);
  });
});

describe("requestSortKey", () => {
  it("orders by path, then method, then category, then scenario id", () => {
    const keys = [
      requestSortKey({ path: "/b", method: "GET", category: "positive", scenarioId: "s1" }),
      requestSortKey({ path: "/a", method: "POST", category: "positive", scenarioId: "s2" }),
      requestSortKey({ path: "/a", method: "GET", category: "positive", scenarioId: "s4" }),
      requestSortKey({ path: "/a", method: "GET", category: "invalid-type", scenarioId: "s3" }),
      requestSortKey({ path: "/a", method: "GET", category: "invalid-type", scenarioId: "s0" }),
    ];
    const ordered = [...keys].sort(compareRequestSortKeys).map((key) => key.scenarioId);
    expect(ordered).toEqual(["s0", "s3", "s4", "s2", "s1"]);
  });

  it("produces the same order regardless of input order", () => {
    const keys = [
      requestSortKey({ path: "/a", method: "GET", category: "positive", scenarioId: "s1" }),
      requestSortKey({ path: "/a", method: "GET", category: "positive", scenarioId: "s2" }),
      requestSortKey({ path: "/a", method: "GET", category: "positive", scenarioId: "s3" }),
    ];
    const forward = [...keys].sort(compareRequestSortKeys).map((key) => key.scenarioId);
    const reversed = [...keys].reverse().sort(compareRequestSortKeys).map((key) => key.scenarioId);
    expect(reversed).toEqual(forward);
  });
});

describe("sortedEntries", () => {
  it("orders record entries by key using the fixed comparator", () => {
    expect(sortedEntries({ b: 1, A: 2, a: 3 })).toEqual([
      ["A", 2],
      ["a", 3],
      ["b", 1],
    ]);
  });
});

describe("serializeArtifact", () => {
  it("produces identical text for structurally identical values", () => {
    const value = { name: "x", item: [{ id: "1" }] };
    expect(serializeArtifact(value)).toBe(serializeArtifact({ name: "x", item: [{ id: "1" }] }));
  });

  it("preserves the emitting type's key order rather than re-sorting it", () => {
    expect(serializeArtifact({ info: 1, variable: 2 })).toContain('"info"');
    expect(serializeArtifact({ info: 1, variable: 2 }).indexOf('"info"')).toBeLessThan(
      serializeArtifact({ info: 1, variable: 2 }).indexOf('"variable"'),
    );
  });
});
