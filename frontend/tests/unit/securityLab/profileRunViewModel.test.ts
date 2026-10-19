import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnvironmentTier } from "@apipilot/shared-domain";
import {
  allowsAddressRanges,
  allowsRelaxedTls,
  credentialSummary,
  draftFromProfile,
  inputFromDraft,
  parseList,
  parsePorts,
  parseProfileViolations,
  requiresTargetRetype,
  statusForIdentity,
  violationText,
} from "../../../src/components/securityLab/profileViewModel";
import {
  CLEANUP_STATE,
  OUTCOME_EXPLANATION,
  RUN_STATUS,
  buildConfirmation,
  checkLimits,
  checkStart,
  failedCleanup,
  isRunFinal,
  isSelectable,
  limitInputsFrom,
  missingConfirmationText,
  parsePlanProblems,
  unselectableReasons,
} from "../../../src/components/securityLab/runViewModel";
import { SCENARIO_OUTCOME_KINDS } from "@apipilot/shared-domain";
import { NO_FLAGS, cleanupEntry, runPreview, scenarioItem, securityProfile } from "./securityFixtures";

const TIER_POLICY = readFileSync(join(__dirname, "../../../../backend/src/securityLab/profiles/tierPolicy.ts"), "utf8");
const TIERS: EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];

describe("tier rules mirror the backend tier policy", () => {
  it("is pinned to the backend source", () => {
    expect(TIER_POLICY).toMatch(/export function allowsRestrictedAddresses\([^)]*\)[^{]*\{\s*return tier === "local";/);
    expect(TIER_POLICY).toMatch(/export function allowsRelaxedTls\([^)]*\)[^{]*\{\s*return tier === "local";/);
    expect(TIER_POLICY).toMatch(/export function requiresTargetRetype\([^)]*\)[^{]*\{\s*return tierKind\(tier\) === "staging-like";/);
    expect(TIER_POLICY).toMatch(/if \(tier === "local"\) return "local";/);
    expect(TIER_POLICY).toMatch(/if \(tier === "production"\) return "refused";/);
  });

  it.each(TIERS)("applies the same rules for %s", (tier) => {
    expect(allowsAddressRanges(tier)).toBe(tier === "local");
    expect(allowsRelaxedTls(tier)).toBe(tier === "local");
    expect(requiresTargetRetype(tier)).toBe(tier !== "local" && tier !== "production");
  });
});

describe("profile drafts", () => {
  it("round-trips a profile through its draft", () => {
    const profile = securityProfile({
      allowedPorts: [443, 8443],
      testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "42", operationKey: "GET /orders/{id}" }],
      cleanup: { strategy: "delete-created-via-spec", idField: "id" },
      destructivePermitted: true,
    });
    const { input, errors } = inputFromDraft(draftFromProfile(profile), "staging");
    expect(errors).toEqual([]);
    const { id, createdAt, updatedAt, ...expected } = profile;
    void id;
    void createdAt;
    void updatedAt;
    expect(input).toEqual(expected);
  });

  it("starts a new profile from the server's own defaults", () => {
    const { input } = inputFromDraft({ ...draftFromProfile(), name: "New", environmentId: "env-1" }, "local");
    expect(input).toMatchObject({ timeoutMs: 10000, maxRequests: 100, maxConcurrency: 1, tlsPolicy: "verify", cleanup: { strategy: "none" }, destructivePermitted: false });
  });

  it("sends address ranges and relaxed TLS only for a local target", () => {
    const draft = { ...draftFromProfile(securityProfile({ tlsPolicy: "relaxed-local", allowedAddressRanges: ["127.0.0.1"] })) };
    expect(inputFromDraft(draft, "local").input).toMatchObject({ allowedAddressRanges: ["127.0.0.1"], tlsPolicy: "relaxed-local" });
    expect(inputFromDraft(draft, "staging").input).toMatchObject({ allowedAddressRanges: [], tlsPolicy: "verify" });
  });

  it("names a port or a limit it cannot read instead of dropping or guessing it", () => {
    const draft = { ...draftFromProfile(securityProfile()), allowedPorts: "443, https", maxRequests: "ten", timeoutMs: "0" };
    const result = inputFromDraft(draft, "staging");
    expect(result.input).toBeUndefined();
    expect(result.errors.map((entry) => entry.field)).toEqual(["allowedPorts", "timeoutMs", "maxRequests"]);
    expect(result.errors[0].message).toBe("These are not port numbers: https.");
  });

  it("needs an id field for delete-based cleanup", () => {
    const draft = { ...draftFromProfile(securityProfile()), cleanupStrategy: "delete-created-via-spec" as const, cleanupIdField: " " };
    expect(inputFromDraft(draft, "staging").errors).toEqual([{ field: "cleanup.idField", message: "Name the response field that holds the id of what a scenario creates." }]);
  });

  it("parses lists and ports", () => {
    expect(parseList("a, b\n\n c ")).toEqual(["a", "b", "c"]);
    expect(parsePorts("443, 80\n8080")).toEqual({ ports: [443, 80, 8080], invalid: [] });
  });

  it("words violations with their code, field and sentence, and reads them defensively", () => {
    expect(violationText({ field: "timeoutMs", code: "limit_above_ceiling", message: "Too high." })).toBe("limit_above_ceiling (timeoutMs): Too high.");
    expect(parseProfileViolations({ violations: [{ field: "a", code: "name_duplicate", message: "m" }, { field: 1 }] })).toEqual([{ field: "a", code: "name_duplicate", message: "m" }]);
    expect(parseProfileViolations({})).toEqual([]);
  });

  it("summarizes credentials by whether they are set, never by value", () => {
    const status = [
      { identity: "alice", scheme: "s", kind: "active" as const, set: true },
      { identity: "bob", scheme: "s", kind: "active" as const, set: false },
    ];
    expect(credentialSummary(status)).toBe("1 of 2 credentials set");
    expect(credentialSummary([])).toBe("No credentials declared");
    expect(statusForIdentity(status, "bob")).toEqual([status[1]]);
  });
});

describe("unselectableReasons (FR-029, FR-041)", () => {
  const profile = securityProfile({ permittedCategories: ["authentication"], destructivePermitted: false });

  it("says a profile must be chosen first", () => {
    expect(unselectableReasons(scenarioItem(), undefined)).toEqual(["Choose a profile first: a scenario is judged against the profile it would run with."]);
  });

  it("allows an approved, executable scenario the profile permits", () => {
    const item = scenarioItem({ reviewState: "approved", flags: { ...NO_FLAGS, executable: true } });
    expect(unselectableReasons(item, profile)).toEqual([]);
    expect(isSelectable(item, profile)).toBe(true);
  });

  it("gives every reason in words, not just the first", () => {
    const item = scenarioItem({
      reviewState: "approved",
      categoryId: "input-validation",
      destructive: true,
      flags: { ...NO_FLAGS, stale: true, blocked: true },
      prerequisites: { total: 3, met: 1 },
    });
    expect(unselectableReasons(item, profile)).toEqual([
      "Its operation changed since it was generated. Regenerate it and approve the new version.",
      'The profile does not permit the "input-validation" category.',
      "It may change or delete data, and the profile does not permit destructive scenarios.",
      "2 of 3 prerequisites are not met by this profile (an identity, a role, test data or a credential it lacks).",
    ]);
    expect(isSelectable(item, profile)).toBe(false);
  });

  it.each([
    [{ specificationNotLoaded: true }, "No specification is loaded"],
    [{ orphaned: true }, "no longer in the specification"],
  ])("explains %j", (flags, text) => {
    const item = scenarioItem({ reviewState: "approved", flags: { ...NO_FLAGS, ...flags } });
    expect(unselectableReasons(item, profile).join(" ")).toContain(text);
  });

  it("does not leave an unexecutable scenario without a reason", () => {
    const reasons = unselectableReasons(scenarioItem({ reviewState: "approved" }), profile);
    expect(reasons).toEqual(["Its approval is not current for this version."]);
  });
});

describe("run limits can only be lowered (R11)", () => {
  const profile = securityProfile({ maxRequests: 100, maxConcurrency: 4, timeoutMs: 10000 });

  it("sends only the limits that are lower than the profile's", () => {
    expect(checkLimits({ ...limitInputsFrom(profile), maxRequests: "20" }, profile)).toEqual({ overrides: { maxRequests: 20 }, errors: [] });
    expect(checkLimits(limitInputsFrom(profile), profile)).toEqual({ overrides: {}, errors: [] });
  });

  it("refuses a value above the profile's, naming both, instead of clamping it", () => {
    const { overrides, errors } = checkLimits({ ...limitInputsFrom(profile), maxConcurrency: "5" }, profile);
    expect(overrides).toEqual({});
    expect(errors).toEqual(["Most requests at once is 5, above the 4 this profile allows. A run can lower a limit but never raise it."]);
  });

  it("refuses a value that is not a whole number of at least 1", () => {
    const { errors } = checkLimits({ maxRequests: "0", maxConcurrency: "x", timeoutMs: "1.5" }, profile);
    expect(errors).toHaveLength(3);
  });
});

describe("checkStart and buildConfirmation (FR-043, FR-045)", () => {
  const destructive = { scenarioId: "ss-d", version: 1, title: "Delete an order", operationKey: "DELETE /orders/{id}", categoryId: "authentication", plannedRequests: 1, destructive: true };
  const staging = runPreview({ scenarios: [destructive] }).summary;
  const local = runPreview({ summary: { tier: "local", environmentName: "Local", baseUrl: "http://127.0.0.1:3000" } }).summary;
  const typed = (overrides: Partial<Parameters<typeof checkStart>[2]> = {}) => ({ attested: true, typedName: "Staging", typedUrl: "https://api.example.test", destructiveConfirmed: new Set(["ss-d"]), ...overrides });

  it("allows start when everything the tier needs is done", () => {
    expect(checkStart(staging, [], typed())).toEqual({ canStart: true, reasons: [] });
  });

  it.each([
    ["the attestation", { attested: false }, "Confirm that you are authorized to test this target."],
    ["the target name", { typedName: "staging" }, "Type the exact target name."],
    ["the base URL", { typedUrl: "https://api.example.test/" }, "Type the exact base URL."],
    ["a destructive confirmation", { destructiveConfirmed: new Set<string>() }, "Confirm each destructive scenario (1 not confirmed)."],
  ])("does not allow start without %s", (_label, overrides, reason) => {
    const result = checkStart(staging, [], typed(overrides));
    expect(result.canStart).toBe(false);
    expect(result.reasons).toEqual([reason]);
  });

  it("compares the typed name and URL exactly: no trimming and no case folding", () => {
    expect(checkStart(staging, [], typed({ typedName: "Staging " })).canStart).toBe(false);
    expect(checkStart(staging, [], typed({ typedUrl: "HTTPS://api.example.test" })).canStart).toBe(false);
  });

  it("needs no typing for a local target", () => {
    expect(checkStart(local, [], { attested: true, typedName: "", typedUrl: "", destructiveConfirmed: new Set() }).canStart).toBe(true);
  });

  it("never allows a plan with problems", () => {
    expect(checkStart(staging, [{ code: "not_approved", message: "x" }], typed()).reasons).toContain("The plan has problems. Fix them and preview again.");
  });

  it("sends what was typed for a staging target, and the previewed names for a local one", () => {
    expect(buildConfirmation(staging, typed())).toEqual({ targetName: "Staging", targetBaseUrl: "https://api.example.test", authorizationAttested: true, destructiveScenarioIds: ["ss-d"] });
    expect(buildConfirmation(local, { attested: true, typedName: "", typedUrl: "", destructiveConfirmed: new Set() })).toEqual({
      targetName: "Local",
      targetBaseUrl: "http://127.0.0.1:3000",
      authorizationAttested: true,
      destructiveScenarioIds: [],
    });
  });

  it("sends only destructive ids that are in the plan", () => {
    expect(buildConfirmation(staging, typed({ destructiveConfirmed: new Set(["ss-d", "ss-other"]) })).destructiveScenarioIds).toEqual(["ss-d"]);
  });
});

describe("server problems and statuses", () => {
  it("reads plan problems and missing confirmations from error details", () => {
    expect(parsePlanProblems({ problems: [{ code: "not_approved", message: "m", scenarioId: "a" }, { code: 1 }] })).toEqual([{ code: "not_approved", message: "m", scenarioId: "a" }]);
    expect(parsePlanProblems({})).toEqual([]);
    expect(missingConfirmationText({ missing: ["authorizationAttested", "targetName", "targetBaseUrl", "destructiveScenarioIds:ss-1"] })).toEqual([
      "The authorization confirmation is missing.",
      "The typed target name does not match.",
      "The typed base URL does not match.",
      "A destructive scenario is not confirmed (ss-1).",
    ]);
  });

  it("knows which statuses are final", () => {
    expect(isRunFinal("in-progress")).toBe(false);
    for (const status of ["completed", "cancelled", "failed"] as const) expect(isRunFinal(status)).toBe(true);
    expect(Object.keys(RUN_STATUS).sort()).toEqual(["cancelled", "completed", "failed", "in-progress"]);
  });

  it("explains every outcome, and never lets blocked, errored or not run read as passed", () => {
    expect(Object.keys(OUTCOME_EXPLANATION).sort()).toEqual([...SCENARIO_OUTCOME_KINDS].sort());
    for (const kind of ["blocked", "errored", "not_run"] as const) expect(OUTCOME_EXPLANATION[kind]).toMatch(/not a pass/i);
    expect(OUTCOME_EXPLANATION.passed).toMatch(/not proof/);
  });

  it("separates failed cleanup from the rest", () => {
    const entries = [cleanupEntry(), cleanupEntry({ state: "failed", leftBehind: "Order 43" }), cleanupEntry({ state: "skipped" })];
    expect(failedCleanup(entries)).toEqual([entries[1]]);
    expect(CLEANUP_STATE.failed.label).toBe("Failed");
  });
});
