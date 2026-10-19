import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvaluationCondition, ScenarioDerivedFlags, SecurityReviewAction, SecurityReviewState } from "@apipilot/shared-domain";
import { SECURITY_REVIEW_ACTIONS, SECURITY_REVIEW_STATES } from "@apipilot/shared-domain";
import {
  EDITABLE_FIELDS,
  MATERIAL_FIELDS,
  NEEDS_CURRENT_BASIS,
  REVIEW_TRANSITIONS,
  actionBlockedReason,
  actionsOffered,
  activeFilterCount,
  allowedActions,
  approvalView,
  changesFromDraft,
  describeCondition,
  draftFromContent,
  expectedBasisView,
  flagViews,
  formatTimestamp,
  isMaterialEdit,
  joinCandidates,
  outcomeSummary,
  parseViolations,
  partitionBatch,
  summarizePrerequisites,
  totalExcluded,
  withFilter,
  type BatchCandidate,
} from "../../../src/components/securityLab/scenarioViewModel";
import { NO_FLAGS, scenarioContent, scenarioItem, versionSummary } from "./securityFixtures";

const BACKEND = join(__dirname, "../../../../backend/src/securityLab");
const read = (relative: string): string => readFileSync(join(BACKEND, relative), "utf8");

/** The quoted strings of the `[...]` list assigned to `name` in a backend source file. */
function quotedList(source: string, name: string): string[] {
  const match = new RegExp(`${name}[^=]*=\\s*(?:new Set\\()?\\[([^\\]]*)\\]`).exec(source);
  if (!match) throw new Error(`${name} was not found in the backend source; update this pin.`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

describe("mirrors of backend rules are pinned to the backend source", () => {
  it("MATERIAL_FIELDS equals scenarioIdentity.ts MATERIAL_FIELDS", () => {
    expect([...MATERIAL_FIELDS]).toEqual(quotedList(read("scenarios/scenarioIdentity.ts"), "MATERIAL_FIELDS"));
  });

  it("EDITABLE_FIELDS equals reviewService.ts EDITABLE_FIELDS", () => {
    expect([...EDITABLE_FIELDS]).toEqual(quotedList(read("review/reviewService.ts"), "EDITABLE_FIELDS"));
  });

  it("NEEDS_CURRENT_BASIS equals reviewService.ts NEEDS_CURRENT_BASIS", () => {
    expect([...NEEDS_CURRENT_BASIS].sort()).toEqual(quotedList(read("review/reviewService.ts"), "NEEDS_CURRENT_BASIS").sort());
  });

  it("REVIEW_TRANSITIONS equals the transition table in stateMachine.ts, entry by entry", () => {
    const source = read("review/stateMachine.ts");
    const block = /const TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
    if (!block) throw new Error("The TRANSITIONS table was not found in the backend source; update this pin.");
    const parsed: Record<string, Record<string, string>> = {};
    for (const row of block[1].matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
      parsed[row[1]] = Object.fromEntries([...row[2].matchAll(/(\w+):\s*"(\w+)"/g)].map((pair) => [pair[1], pair[2]]));
    }
    expect(Object.keys(parsed).sort()).toEqual([...SECURITY_REVIEW_STATES].sort());
    expect(REVIEW_TRANSITIONS).toEqual(parsed);
  });

  it("every editable field is a field of the scenario content, and every material field is editable or fixed by the backend", () => {
    const fixed = ["operationKey", "categoryId"];
    for (const field of MATERIAL_FIELDS) {
      const root = field.split(".")[0];
      expect(EDITABLE_FIELDS.includes(root as never) || fixed.includes(field)).toBe(true);
    }
  });
});

describe("isMaterialEdit (FR-030)", () => {
  const before = scenarioContent();

  it.each([
    ["title", { title: "A clearer title" }],
    ["objective", { objective: "Another objective" }],
    ["rationale", { rationale: "Another rationale" }],
    ["impact", { impact: "Another impact" }],
    ["suggestedSeverity", { suggestedSeverity: "low" as const }],
    ["limitations", { limitations: ["Does not prove the server is safe."] }],
    ["manualInputs", { manualInputs: ["A valid order id"] }],
    ["prerequisites", { prerequisites: [{ id: "p1", kind: "identity" as const, description: "An identity" }] }],
    ["destructive reasons only", { destructive: { flag: false, reasons: ["noted"] } }],
  ])("does not treat a change to %s as material", (_name, changes) => {
    expect(isMaterialEdit(before, changes)).toBe(false);
  });

  it.each([
    ["baseRequest", { baseRequest: { pathParameters: {}, queryParameters: { page: 2 }, headers: {} } }],
    ["mutations", { mutations: [{ kind: "auth.malformed" as const }] }],
    ["expected", { expected: { ...before.expected, statement: "Something else." } }],
    ["conditions", { conditions: [{ kind: "status.equals" as const, code: 403 }] }],
    ["plannedRequestCount", { plannedRequestCount: 2 }],
    ["requiredIdentities", { requiredIdentities: [{ role: "user", label: "Ordinary user" }] }],
    ["destructive.flag", { destructive: { flag: true, reasons: [] } }],
  ])("treats a change to %s as material", (_name, changes) => {
    expect(isMaterialEdit(before, changes)).toBe(true);
  });

  it("is not material when a field is rewritten to the same value, whatever the key order", () => {
    expect(isMaterialEdit(before, { baseRequest: { headers: { Accept: "application/json" }, queryParameters: {}, pathParameters: {} } })).toBe(false);
    expect(isMaterialEdit(before, {})).toBe(false);
  });
});

describe("changesFromDraft", () => {
  const content = scenarioContent();

  it("returns nothing for an untouched draft", () => {
    expect(changesFromDraft(content, draftFromContent(content))).toEqual({ changes: {}, errors: {} });
  });

  it("returns only the fields that differ, parsed from their text", () => {
    const draft = { ...draftFromContent(content), title: "New title", conditions: '[{"kind":"status.equals","code":403}]' };
    const { changes, errors } = changesFromDraft(content, draft);
    expect(errors).toEqual({});
    expect(changes).toEqual({ title: "New title", conditions: [{ kind: "status.equals", code: 403 }] });
  });

  it("names a JSON field that does not parse or has the wrong shape, and sends nothing for it", () => {
    const draft = { ...draftFromContent(content), baseRequest: "{not json", expected: "[1]", conditions: '{"kind":"x"}' };
    const { changes, errors } = changesFromDraft(content, draft);
    expect(errors).toEqual({ baseRequest: "This is not valid JSON.", expected: "This must be a JSON object.", conditions: "This must be a JSON array." });
    expect(changes).toEqual({});
  });
});

describe("flags (FR-004, FR-029)", () => {
  it("lists only set flags, in a fixed order, each with a text label and an explanation", () => {
    const views = flagViews({ specificationNotLoaded: true, stale: true, orphaned: true, blocked: true, executable: true });
    expect(views.map((view) => view.label)).toEqual(["Specification not loaded", "Orphaned", "Stale", "Blocked", "Executable"]);
    for (const view of views) expect(view.explanation.length).toBeGreaterThan(20);
    expect(flagViews(NO_FLAGS)).toEqual([]);
    expect(flagViews({ ...NO_FLAGS, stale: true }).map((view) => view.key)).toEqual(["stale"]);
  });

  it("gives the reason an action that needs the specification is blocked, and none for actions that do not", () => {
    const flagged = (patch: Partial<ScenarioDerivedFlags>): ScenarioDerivedFlags => ({ ...NO_FLAGS, ...patch });
    expect(actionBlockedReason(flagged({ specificationNotLoaded: true }), "approve")).toMatch(/No specification is loaded/);
    expect(actionBlockedReason(flagged({ orphaned: true }), "submit")).toMatch(/no longer in the specification/);
    expect(actionBlockedReason(flagged({ stale: true }), "reopen")).toMatch(/changed since this scenario was generated/);
    for (const action of ["reject", "withdraw"] as const) expect(actionBlockedReason(flagged({ specificationNotLoaded: true, stale: true }), action)).toBeUndefined();
    expect(actionBlockedReason(NO_FLAGS, "approve")).toBeUndefined();
    // An incomplete scenario can still be approved: approval does not depend on prerequisites.
    expect(actionBlockedReason(flagged({ blocked: true }), "approve")).toBeUndefined();
  });
});

describe("filters", () => {
  it("counts applied filters and removes a filter set to empty", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ q: "orders", severity: "high" })).toBe(2);
    expect(withFilter({ q: "orders", severity: "high" }, "severity", "")).toEqual({ q: "orders" });
    expect(withFilter({}, "category", "authentication")).toEqual({ category: "authentication" });
  });
});

describe("review actions (FR-028)", () => {
  it("offers exactly the actions each state allows", () => {
    expect(allowedActions("draft")).toEqual(["submit", "reject"]);
    expect(allowedActions("in_review")).toEqual(["approve", "reject", "withdraw"]);
    expect(allowedActions("approved")).toEqual(["reject", "withdraw"]);
    expect(allowedActions("rejected")).toEqual(["reopen"]);
  });

  it("offers an action for a set when at least one scenario can take it", () => {
    const candidates = [candidate("a", { reviewState: "draft" }), candidate("b", { reviewState: "rejected" })];
    expect(actionsOffered(candidates)).toEqual(["submit", "reject", "reopen"]);
    expect(actionsOffered([])).toEqual([]);
  });
});

function candidate(id: string, overrides: Partial<BatchCandidate> = {}): BatchCandidate {
  return { id, version: 1, title: `Scenario ${id}`, operationKey: "GET /orders", reviewState: "in_review", destructive: false, flags: { ...NO_FLAGS }, ...overrides };
}

describe("partitionBatch (FR-031, FR-033)", () => {
  const set: BatchCandidate[] = [
    candidate("ok-1"),
    candidate("ok-2"),
    candidate("destructive", { destructive: true }),
    candidate("incomplete", { flags: { ...NO_FLAGS, blocked: true } }),
    candidate("stale", { flags: { ...NO_FLAGS, stale: true } }),
    candidate("draft", { reviewState: "draft" }),
  ];
  const off = { includeDestructive: false, includeIncomplete: false };

  it("leaves destructive and incomplete scenarios out by default and counts each reason once", () => {
    const result = partitionBatch(set, "approve", off);
    expect(result.send.map((entry) => entry.id)).toEqual(["ok-1", "ok-2"]);
    expect(result.excluded).toEqual({ notAllowedFromState: 1, needsCurrentSpecification: 1, destructive: 1, incomplete: 1 });
    expect(totalExcluded(result.excluded)).toBe(4);
    expect(result.destructiveSent).toEqual([]);
  });

  it("brings destructive scenarios in only by choice, and names them for the separate confirmation", () => {
    const result = partitionBatch(set, "approve", { ...off, includeDestructive: true });
    expect(result.send.map((entry) => entry.id)).toEqual(["ok-1", "ok-2", "destructive"]);
    expect(result.destructiveSent.map((entry) => entry.id)).toEqual(["destructive"]);
  });

  it("brings incomplete scenarios in only by choice", () => {
    const result = partitionBatch(set, "approve", { ...off, includeIncomplete: true });
    expect(result.send.map((entry) => entry.id)).toEqual(["ok-1", "ok-2", "incomplete"]);
  });

  it("never brings in a scenario the specification cannot vouch for, for an action that could lead to a run", () => {
    const result = partitionBatch(set, "approve", { includeDestructive: true, includeIncomplete: true });
    expect(result.send.map((entry) => entry.id)).not.toContain("stale");
    expect(result.excluded.needsCurrentSpecification).toBe(1);
  });

  it("treats a flagged scenario as incomplete, not unusable, for an action that sends nothing", () => {
    const withdrawable = [candidate("stale", { flags: { ...NO_FLAGS, stale: true } })];
    expect(partitionBatch(withdrawable, "withdraw", off).excluded).toMatchObject({ incomplete: 1, needsCurrentSpecification: 0 });
    expect(partitionBatch(withdrawable, "withdraw", { ...off, includeIncomplete: true }).send).toHaveLength(1);
  });

  it("agrees with the transition table for every state and action", () => {
    for (const state of SECURITY_REVIEW_STATES as readonly SecurityReviewState[]) {
      for (const action of SECURITY_REVIEW_ACTIONS as readonly SecurityReviewAction[]) {
        const result = partitionBatch([candidate("x", { reviewState: state })], action, { includeDestructive: true, includeIncomplete: true });
        expect(result.send.length === 1).toBe(REVIEW_TRANSITIONS[state][action] !== undefined);
      }
    }
  });
});

describe("joinCandidates", () => {
  it("names the version the id endpoint returned, and counts ids with no details as missing", () => {
    const items = [scenarioItem({ id: "a", currentVersion: 3, title: "A" })];
    const { candidates, missing } = joinCandidates(
      [
        { id: "a", version: 2 },
        { id: "gone", version: 1 },
      ],
      items,
    );
    expect(missing).toBe(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: "a", version: 2, title: "A" });
  });
});

describe("outcomeSummary", () => {
  it("states a partial application as one, never as complete", () => {
    expect(outcomeSummary("approve", 3, 2)).toBe("3 of 5 scenarios were approved; 2 were refused.");
    expect(outcomeSummary("approve", 5, 0)).toBe("5 of 5 scenarios were approved.");
    expect(outcomeSummary("reject", 0, 2)).toBe("None of the 2 scenarios were rejected; all were refused.");
    expect(outcomeSummary("submit", 0, 1)).toBe("The scenario was not submitted for review: it was refused.");
    expect(outcomeSummary("submit", 1, 0)).toBe("1 of 1 scenario was submitted for review.");
    expect(outcomeSummary("withdraw", 1, 2)).toBe("1 of 3 scenarios was withdrawn; 2 were refused.");
  });
});

describe("violations, conditions, basis, approvals", () => {
  it("reads violations defensively", () => {
    expect(parseViolations({ violations: [{ pointer: "/rationale", code: "url_in_content", message: "no urls" }, { pointer: 1 }, "x"] })).toEqual([
      { pointer: "/rationale", code: "url_in_content", message: "no urls" },
    ]);
    expect(parseViolations({})).toEqual([]);
  });

  it("words every evaluation condition kind distinctly", () => {
    const all: EvaluationCondition[] = [
      { kind: "status.not-success" },
      { kind: "status.in-set", codes: [401, 403] },
      { kind: "status.equals", code: 200 },
      { kind: "status.not-equals", code: 500 },
      { kind: "header.present", name: "X-A" },
      { kind: "header.absent", name: "Server" },
      { kind: "header.value-not-contains", name: "Server", token: "nginx" },
      { kind: "body.field-absent", path: "password" },
      { kind: "body.field-present", path: "id" },
      { kind: "body.not-match-leak-pattern", patternId: "stack-trace" },
      { kind: "repeat.limit-engaged", withinRequests: 20 },
      { kind: "persisted.field-unchanged", path: "role" },
    ];
    const texts = all.map(describeCondition);
    expect(new Set(texts).size).toBe(all.length);
    expect(texts[1]).toBe("The response status is one of 401, 403.");
    expect(texts[6]).toBe('The "Server" header does not contain "nginx".');
  });

  it("tells a documented expectation from a named product rule", () => {
    const documented = expectedBasisView(scenarioContent().expected);
    expect(documented.label).toBe("Documented in the specification");
    expect(documented.detail).toMatch(/Documented status codes: 401/);
    expect(documented.detail).toMatch(/#\/paths\/~1orders\/get\/responses\/401/);
    const rule = expectedBasisView({ kind: "rejected", statement: "x", basis: "product-rule", ruleId: "authentication.omit-credentials" });
    expect(rule.label).toBe("Product rule");
    expect(rule.detail).toMatch(/authentication\.omit-credentials/);
    expect(rule.detail).toMatch(/does not document/);
  });

  it("names exactly what is missing", () => {
    const summary = summarizePrerequisites([
      { id: "1", kind: "identity", description: "An administrator identity", state: "missing" },
      { id: "2", kind: "test-data", description: "A valid order id", state: "met" },
      { id: "3", kind: "role", description: "A second role" },
    ]);
    expect(summary).toMatchObject({ total: 3, met: 1 });
    expect(summary.unmet.map((entry) => entry.description)).toEqual(["An administrator identity", "A second role"]);
  });

  it("says which version an approval applies to, whether it was carried over or withdrawn, and when it is not current", () => {
    const approval = { version: 2, contentHash: "h", approvedAt: "2026-10-18T10:00:00.000Z", actor: "x", destructiveConfirmed: false };
    expect(approvalView(versionSummary({ version: 2 }), 2)).toBeUndefined();
    expect(approvalView(versionSummary({ version: 2, approval }), 2)).toEqual({ headline: "Approval applies to version 2", details: ["Approved 2026-10-18 10:00 UTC."] });
    expect(approvalView(versionSummary({ version: 2, approval: { ...approval, carriedFromVersion: 1 } }), 2)?.details).toContain("Carried over from version 1 because this edit was not material.");
    expect(approvalView(versionSummary({ version: 2, approval: { ...approval, withdrawnAt: "2026-10-18T11:00:00.000Z" } }), 3)?.details).toContain("Withdrawn 2026-10-18 11:00 UTC.");
    expect(approvalView(versionSummary({ version: 2, approval }), 3)?.details.join(" ")).toMatch(/Not current: version 3 is the current version/);
  });

  it("formats a timestamp without the machine's locale or zone", () => {
    expect(formatTimestamp("2026-10-18T09:12:03.000Z")).toBe("2026-10-18 09:12 UTC");
    expect(formatTimestamp("not a date")).toBe("not a date");
  });
});
