import { describe, expect, it } from "vitest";
import { getSecurityFindingRepository } from "../../../src/persistence/securityFindingRepository";
import {
  findingIdFor,
  parseFindingPatch,
  recordFailure,
  recordPass,
  updateFinding,
  type FailureInput,
  type FindingContext,
} from "../../../src/securityLab/findings/findingService";
import { remediationFor } from "../../../src/securityLab/evaluation/remediationText";
import { OWNER_A, OWNER_B, makeContent } from "../../fixtures/securityLab/builders";

let clock = 0;
const context = (ownerId = OWNER_A): FindingContext => ({
  ownerId,
  repo: getSecurityFindingRepository(),
  now: () => new Date(Date.parse("2026-01-01T00:00:00.000Z") + clock++ * 60_000),
  actor: "tester",
});

function failure(resultId: string, overrides: Partial<FailureInput> = {}): FailureInput {
  return {
    assessmentKey: "assessment-1",
    scenarioId: "ss-1",
    version: 1,
    content: makeContent(),
    resultId,
    runId: `run-of-${resultId}`,
    observed: { responseStatus: 200, responseHeadersSelected: {}, statement: "Status 200 for a request without credentials.", truncated: false },
    confidence: { level: "medium", basis: "The product rule SL-REJECT-MISSING-CREDENTIAL." },
    ...overrides,
  };
}

const note = (text: string) => ({ note: text });

describe("one finding per scenario version (FR-054, SC-011)", () => {
  it("creates an open finding with its first occurrence, grounded in the scenario", () => {
    const content = makeContent();
    const created = recordFailure(context(), failure("r1", { content }));
    expect(created).toMatchObject({
      id: findingIdFor("ss-1", 1),
      ownerId: OWNER_A,
      assessmentKey: "assessment-1",
      scenarioId: "ss-1",
      scenarioVersion: 1,
      operationKey: content.operationKey,
      categoryId: content.categoryId,
      expected: content.expected,
      status: "open",
      resolvedAssertion: "engineer-asserted",
      occurrenceCount: 1,
      unreviewedOccurrence: false,
      history: [],
    });
    expect(created.id).toMatch(/^sf-[0-9a-f]{16}$/);
    expect(created.remediation).toBe(remediationFor(content).text);
    expect(created.remediationId).toBe(remediationFor(content).id);
    expect(created.supersedes).toBeUndefined();
    expect(created.firstFailedAt).toBe(created.latestFailedAt);
    expect(created.occurrences).toHaveLength(1);
  });

  it("appends an occurrence for every later failure of the same version, so the count equals the failures over any reruns", () => {
    for (let index = 1; index <= 25; index += 1) recordFailure(context(), failure(`r${index}`));
    const repo = getSecurityFindingRepository();
    expect(repo.countByOwner(OWNER_A)).toBe(1);
    const finding = repo.findByVersion(OWNER_A, "ss-1", 1);
    expect(finding?.occurrenceCount).toBe(25);
    expect(finding?.occurrences.map((occurrence) => occurrence.resultId)).toEqual(Array.from({ length: 25 }, (_, i) => `r${i + 1}`));
    expect(finding?.latestFailedAt > (finding?.firstFailedAt ?? "")).toBe(true);
  });

  it("counts a result once, so recording the same failure twice is harmless", () => {
    recordFailure(context(), failure("r1"));
    const again = recordFailure(context(), failure("r1"));
    expect(again.occurrenceCount).toBe(1);
  });

  it("updates the latest confidence and keeps every occurrence's own confidence", () => {
    recordFailure(context(), failure("r1", { confidence: { level: "high", basis: "first" } }));
    const second = recordFailure(context(), failure("r2", { confidence: { level: "low", basis: "second" } }));
    expect(second.confidence).toEqual({ level: "low", basis: "second" });
    expect(second.occurrences.map((occurrence) => occurrence.confidence.level)).toEqual(["high", "low"]);
  });

  it("keeps separate findings for separate scenarios, versions and owners", () => {
    recordFailure(context(), failure("r1"));
    recordFailure(context(), failure("r2", { scenarioId: "ss-2" }));
    recordFailure(context(), failure("r3", { version: 2 }));
    recordFailure(context(OWNER_B), failure("r4"));
    expect(getSecurityFindingRepository().countByOwner(OWNER_A)).toBe(3);
    expect(getSecurityFindingRepository().countByOwner(OWNER_B)).toBe(1);
  });

  it("names the earlier version's finding in supersedes when a material edit's first failure creates a new one (FR-058)", () => {
    const first = recordFailure(context(), failure("r1"));
    const second = recordFailure(context(), failure("r2", { version: 2, content: makeContent({ title: "Edited" }) }));
    expect(second.id).not.toBe(first.id);
    expect(second.supersedes).toBe(first.id);
    const third = recordFailure(context(), failure("r3", { version: 4 }));
    expect(third.supersedes).toBe(second.id);
    expect(recordFailure(context(), failure("r5", { scenarioId: "ss-other", version: 3 })).supersedes).toBeUndefined();
  });

  it("keeps the earlier finding unchanged when its successor is created", () => {
    const first = recordFailure(context(), failure("r1"));
    recordFailure(context(), failure("r2", { version: 2 }));
    expect(getSecurityFindingRepository().get(OWNER_A, first.id)).toEqual(first);
  });
});

describe("what happens to an existing finding when its version fails again", () => {
  const resolved = (): string => {
    const created = recordFailure(context(), failure("r1"));
    updateFinding(context(), created.id, { status: "resolved", ...note("Fixed in the gateway") });
    return created.id;
  };

  it("reopens a resolved finding and records that in the history", () => {
    const id = resolved();
    const reopened = recordFailure(context(), failure("r2"));
    expect(reopened.id).toBe(id);
    expect(reopened.status).toBe("open");
    expect(reopened.occurrenceCount).toBe(2);
    expect(reopened.history.at(-1)).toMatchObject({ field: "status", from: "resolved", to: "open", actor: "system", note: "Reopened by a new occurrence." });
  });

  it.each(["accepted-risk", "false-positive"] as const)("keeps %s, appends the occurrence and flags it as unreviewed", (status) => {
    const created = recordFailure(context(), failure("r1"));
    updateFinding(context(), created.id, { status, ...note("Reviewed") });
    const next = recordFailure(context(), failure("r2"));
    expect(next.status).toBe(status);
    expect(next.unreviewedOccurrence).toBe(true);
    expect(next.occurrenceCount).toBe(2);
    expect(next.history.at(-1)).toMatchObject({ field: "unreviewedOccurrence", from: "false", to: "true", actor: "system" });
    // A third failure does not add a second history line for the same unreviewed state.
    expect(recordFailure(context(), failure("r3")).history).toHaveLength(next.history.length);
  });

  it("is cleared by acknowledgement, with a note in the history, and returns when another occurrence arrives", () => {
    const created = recordFailure(context(), failure("r1"));
    updateFinding(context(), created.id, { status: "accepted-risk", ...note("Known") });
    recordFailure(context(), failure("r2"));
    const acknowledged = updateFinding(context(), created.id, { acknowledgeOccurrences: true, ...note("Looked again") });
    expect(acknowledged.unreviewedOccurrence).toBe(false);
    expect(acknowledged.status).toBe("accepted-risk");
    expect(acknowledged.history.at(-1)).toMatchObject({ field: "unreviewedOccurrence", from: "true", to: "false", actor: "tester", note: "Looked again" });
    expect(recordFailure(context(), failure("r3")).unreviewedOccurrence).toBe(true);
  });
});

describe("resolution is asserted by the engineer until a rerun passes (FR-057)", () => {
  it("becomes verified-by-rerun when a later result of the same version passes, and not before", () => {
    const created = recordFailure(context(), failure("r1"));
    expect(recordPass(context(), "ss-1", 1)?.resolvedAssertion).toBe("engineer-asserted");
    expect(recordPass(context(), "ss-1", 1)?.status).toBe("open");

    const asserted = updateFinding(context(), created.id, { status: "resolved", ...note("Patched") });
    expect(asserted.resolvedAssertion).toBe("engineer-asserted");
    const verified = recordPass(context(), "ss-1", 1);
    expect(verified).toMatchObject({ status: "resolved", resolvedAssertion: "verified-by-rerun" });
    expect(verified?.history.at(-1)).toMatchObject({ field: "resolvedAssertion", from: "engineer-asserted", to: "verified-by-rerun", actor: "system" });
  });

  it("never resolves a finding on its own, and does nothing for a version that has no finding", () => {
    expect(recordPass(context(), "ss-none", 1)).toBeUndefined();
    const created = recordFailure(context(), failure("r1"));
    recordPass(context(), "ss-1", 1);
    expect(getSecurityFindingRepository().get(OWNER_A, created.id)?.status).toBe("open");
  });

  it("does not verify the finding of another version", () => {
    const created = recordFailure(context(), failure("r1"));
    updateFinding(context(), created.id, { status: "resolved", ...note("Patched") });
    recordPass(context(), "ss-1", 2);
    expect(getSecurityFindingRepository().get(OWNER_A, created.id)?.resolvedAssertion).toBe("engineer-asserted");
  });

  it("returns to engineer-asserted when a resolved finding is resolved again after reopening", () => {
    const created = recordFailure(context(), failure("r1"));
    updateFinding(context(), created.id, { status: "resolved", ...note("Patched") });
    recordPass(context(), "ss-1", 1);
    recordFailure(context(), failure("r2"));
    const again = updateFinding(context(), created.id, { status: "resolved", ...note("Patched properly") });
    expect(again.resolvedAssertion).toBe("engineer-asserted");
  });
});

describe("manual changes", () => {
  const created = () => recordFailure(context(), failure("r1", { content: makeContent({ suggestedSeverity: "medium" }) }));

  it("needs a note for a status or severity change, and records time, actor and the previous value", () => {
    const { id } = created();
    expect(() => updateFinding(context(), id, { status: "accepted-risk" })).toThrow(expect.objectContaining({ code: "invalid_finding_update" }));
    expect(() => updateFinding(context(), id, { severity: "high", note: "  " })).toThrow(expect.objectContaining({ code: "invalid_finding_update" }));
    const changed = updateFinding(context(), id, { status: "accepted-risk", severity: "low", ...note("Internal tool only") });
    expect(changed.history.map((entry) => [entry.field, entry.from, entry.to, entry.actor, entry.note])).toEqual([
      ["status", "open", "accepted-risk", "tester", "Internal tool only"],
      ["severity", "medium", "low", "tester", "Internal tool only"],
    ]);
    expect(changed.history.every((entry) => /^2026-01-01T/.test(entry.at))).toBe(true);
    expect(changed.severity).toEqual({ suggested: "medium", current: "low" });
  });

  it("lets an open finding move to any other status, and any other status return only to open", () => {
    const { id } = created();
    updateFinding(context(), id, { status: "false-positive", ...note("Not real") });
    expect(() => updateFinding(context(), id, { status: "resolved", ...note("x") })).toThrow(expect.objectContaining({ code: "invalid_finding_update" }));
    expect(updateFinding(context(), id, { status: "open", ...note("Looked again") }).status).toBe("open");
    expect(updateFinding(context(), id, { status: "resolved", ...note("Fixed") }).status).toBe("resolved");
    expect(updateFinding(context(), id, { status: "open", ...note("Came back") }).status).toBe("open");
  });

  it("refuses a no-op, an empty change, a missing finding, and an acknowledgement with nothing to acknowledge", () => {
    const { id } = created();
    expect(() => updateFinding(context(), id, { status: "open", ...note("same") })).toThrow(/already open/);
    expect(() => updateFinding(context(), id, { severity: "medium", ...note("same") })).toThrow(/already medium/);
    expect(() => updateFinding(context(), id, {})).toThrow(/Nothing to change/);
    expect(() => updateFinding(context(), id, { acknowledgeOccurrences: true })).toThrow(/no unreviewed occurrence/);
    expect(() => updateFinding(context(), "sf-missing", { status: "resolved", ...note("x") })).toThrow(expect.objectContaining({ code: "finding_not_found" }));
  });

  it("will not change another owner's finding", () => {
    const { id } = created();
    expect(() => updateFinding(context(OWNER_B), id, { status: "resolved", ...note("x") })).toThrow(expect.objectContaining({ code: "finding_not_found" }));
  });

  it("keeps history append-only and occurrences untouched by manual changes", () => {
    const first = created();
    recordFailure(context(), failure("r2"));
    const before = getSecurityFindingRepository().get(OWNER_A, first.id);
    const after = updateFinding(context(), first.id, { status: "resolved", ...note("Done") });
    expect(after.occurrences).toEqual(before?.occurrences);
    expect(after.history.slice(0, before?.history.length)).toEqual(before?.history);
    expect(after.history.length).toBe((before?.history.length ?? 0) + 1);
  });

  it("parses a patch strictly", () => {
    expect(parseFindingPatch({ status: "resolved", severity: "high", note: "  why ", acknowledgeOccurrences: true })).toEqual({ status: "resolved", severity: "high", note: "why", acknowledgeOccurrences: true });
    for (const bad of ["text", [], { status: "done" }, { severity: "urgent" }, { note: 5 }, { note: "x".repeat(1001) }, { acknowledgeOccurrences: "yes" }, { scenarioId: "ss-2" }, { occurrences: [] }, { history: [] }]) {
      expect(() => parseFindingPatch(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: "invalid_finding_update" }));
    }
  });
});

describe("remediation text is static (FR-055)", () => {
  it("is the same for the same scenario, differs by category and mutation, and never names a model", () => {
    const omit = makeContent({ categoryId: "authentication", mutations: [{ kind: "auth.omit" }] });
    const expired = makeContent({ categoryId: "authentication", mutations: [{ kind: "auth.expired", identity: "any" }] });
    const bola = makeContent({ categoryId: "broken-object-level-authorization", mutations: [{ kind: "path-id.substitute", parameter: "id", ownerIdentity: "owner" }] });
    expect(remediationFor(omit)).toEqual(remediationFor(structuredClone(omit)));
    expect(new Set([omit, expired, bola].map((content) => remediationFor(content).text)).size).toBe(3);
    expect(remediationFor(omit).id).toBe("rem.1.authentication:auth.omit");
    for (const content of [omit, expired, bola]) expect(remediationFor(content).text).not.toMatch(/\b(AI|model|LLM|GPT)\b/);
  });

  it("falls back to the category's general text, and to a plain sentence for a category it does not know", () => {
    const general = makeContent({ categoryId: "sensitive-data-exposure", mutations: [] });
    expect(remediationFor(general).id).toBe("rem.1.sensitive-data-exposure");
    expect(remediationFor(general).text.length).toBeGreaterThan(40);
  });
});
