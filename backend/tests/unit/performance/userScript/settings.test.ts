import { describe, expect, it } from "vitest";
import type { ScriptCheckAccepted } from "@apipilot/shared-domain";
import { InvalidMappingNameError, InvalidUserScriptSettingsError } from "../../../../src/performance/errors";
import { validateMappingName } from "../../../../src/performance/userScript/mappingNames";
import { initialSettings, mergeSettingsAfterContentChange, parseSettings, withFoundFlags } from "../../../../src/performance/userScript/settings";

/** AP-034 FR-025 to FR-028 (research R11, R12, R15; tasks T046). */

function check(names: ScriptCheckAccepted["envNames"]): ScriptCheckAccepted {
  return { accepted: true, hosts: [], envNames: names, hasDefaultFunction: true };
}

describe("validateMappingName (FR-026)", () => {
  it.each([
    ["BASE_URL", null],
    ["_x1", null],
    ["A-B", "invalid-characters"],
    ["", "invalid-characters"],
    ["x".repeat(129), "invalid-characters"],
    ["1ABC", "starts-with-digit"],
    ["K6_OUT", "k6-prefix"],
    ["k6_cloud_token", "k6-prefix"],
    ["PATH", "reserved-startup-name"],
    ["path", "reserved-startup-name"],
    ["Path", "reserved-startup-name"],
    ["TMPDIR", "reserved-startup-name"],
    ["SystemRoot", "reserved-startup-name"],
  ] as const)("%s → %s", (name, reason) => {
    expect(validateMappingName(name)).toBe(reason);
  });
});

describe("initial mapping and merging (research R12)", () => {
  it("maps BASE_URL to the base URL, a suggested source as suggested, and every other name to itself", () => {
    const settings = initialSettings(
      check([
        { name: "API_KEY", mappable: true },
        { name: "APIPILOT_V_1", mappable: true, suggestedSource: { kind: "environment-value", valueName: "clientId" } },
        { name: "BASE_URL", mappable: true },
        { name: "K6_OUT", mappable: false, reason: "k6-prefix" },
      ]),
    );
    expect(settings).toEqual({
      // Sorted by code unit, as everywhere in ApiPilot: "P" (0x50) sorts before "_" (0x5F).
      mapping: [
        { name: "APIPILOT_V_1", source: { kind: "environment-value", valueName: "clientId" } },
        { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" } },
        { name: "BASE_URL", source: { kind: "base-url" } },
      ],
      removedNames: [],
      load: { kind: "script" },
      thresholds: [],
    });
  });

  it("after a content change, adds new names, keeps removed ones out and keeps names no longer found", () => {
    const before = { ...initialSettings(check([{ name: "OLD", mappable: true }])), removedNames: ["REMOVED"] };
    const merged = mergeSettingsAfterContentChange(before, check([{ name: "NEW", mappable: true }, { name: "REMOVED", mappable: true }]));
    expect(merged.mapping.map((entry) => entry.name)).toEqual(["NEW", "OLD"]);
    expect(withFoundFlags(merged, check([{ name: "NEW", mappable: true }])).mapping).toEqual([
      { name: "NEW", source: { kind: "environment-value", valueName: "NEW" }, foundInScript: true },
      { name: "OLD", source: { kind: "environment-value", valueName: "OLD" }, foundInScript: false },
    ]);
  });
});

describe("parseSettings", () => {
  const valid = {
    mapping: [{ name: "BASE_URL", source: { kind: "base-url" } }],
    removedNames: [],
    load: { kind: "profile", profile: { kind: "smoke", stages: [{ durationMs: 30_000, targetVirtualUsers: 2 }] } },
    thresholds: [{ scope: { kind: "request-name", name: "GET /orders" }, metric: "p95", comparator: "<=", limit: 500 }],
  };

  it("accepts a valid body, recomputes the planned duration and derives threshold ids", () => {
    const parsed = parseSettings(valid);
    expect(parsed.load).toEqual({ kind: "profile", profile: { kind: "smoke", stages: [{ durationMs: 30_000, targetVirtualUsers: 2 }], plannedDurationMs: 30_000 } });
    expect(parsed.thresholds[0].id).toMatch(/^t_/);
    expect(parseSettings(valid).thresholds[0].id).toBe(parsed.thresholds[0].id);
  });

  it("refuses a bad mapping name with its reason", () => {
    expect(() => parseSettings({ ...valid, mapping: [{ name: "K6_OUT", source: { kind: "base-url" } }] })).toThrow(InvalidMappingNameError);
  });

  it.each([
    ["a duplicate name", { mapping: [{ name: "A", source: { kind: "base-url" } }, { name: "A", source: { kind: "base-url" } }] }],
    ["more than 100 mappings", { mapping: Array.from({ length: 101 }, (_unused, index) => ({ name: `N${index}`, source: { kind: "base-url" } })) }],
    ["more than 50 thresholds", { thresholds: Array.from({ length: 51 }, () => valid.thresholds[0]) }],
    ["an invalid stage", { load: { kind: "profile", profile: { kind: "smoke", stages: [{ durationMs: 0, targetVirtualUsers: 1 }] } } }],
    ["an unknown source", { mapping: [{ name: "A", source: { kind: "file" } }] }],
    ["an error-rate over 100", { thresholds: [{ scope: { kind: "run" }, metric: "error-rate", comparator: "<=", limit: 101 }] }],
  ])("refuses %s", (_label, change) => {
    expect(() => parseSettings({ ...valid, ...change })).toThrow(InvalidUserScriptSettingsError);
  });
});
