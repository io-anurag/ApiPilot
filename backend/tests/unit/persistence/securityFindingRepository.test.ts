import { describe, expect, it } from "vitest";
import { getSecurityFindingRepository } from "../../../src/persistence/securityFindingRepository";
import { OWNER_A, OWNER_B, T0, T1, makeFinding } from "../../fixtures/securityLab/builders";

describe("SecurityFindingRepository", () => {
  it("round-trips the full finding document, owner-scoped", () => {
    const repo = getSecurityFindingRepository();
    const finding = makeFinding();
    repo.save(finding);
    expect(repo.get(OWNER_A, finding.id)).toEqual(finding);
    expect(repo.get(OWNER_B, finding.id)).toBeUndefined();
    expect(repo.countByOwner(OWNER_A)).toBe(1);
  });

  it("finds a finding by scenario version, and there is at most one per version", () => {
    const repo = getSecurityFindingRepository();
    repo.save(makeFinding({ id: "sf-1", scenarioVersion: 1 }));
    repo.save(makeFinding({ id: "sf-2", scenarioVersion: 2, supersedes: "sf-1" }));
    expect(repo.findByVersion(OWNER_A, "ss-0000000000000001", 2)?.id).toBe("sf-2");
    expect(repo.findByVersion(OWNER_A, "ss-0000000000000001", 3)).toBeUndefined();
    // A different id for the same scenario version must be refused by the unique index.
    expect(() => repo.save(makeFinding({ id: "sf-other", scenarioVersion: 2 }))).toThrow(/UNIQUE/);
  });

  it("replaces the stored document and columns when the same finding is saved again", () => {
    const repo = getSecurityFindingRepository();
    repo.save(makeFinding());
    repo.save(
      makeFinding({
        status: "accepted-risk",
        unreviewedOccurrence: true,
        occurrenceCount: 3,
        latestFailedAt: T1,
        severity: { suggested: "high", current: "medium" },
      }),
    );
    const stored = repo.get(OWNER_A, "sf-0000000000000001");
    expect(stored).toMatchObject({ status: "accepted-risk", unreviewedOccurrence: true, occurrenceCount: 3, latestFailedAt: T1 });
    expect(repo.query(OWNER_A, { status: "accepted-risk" }).total).toBe(1);
    expect(repo.query(OWNER_A, { status: "open" }).total).toBe(0);
    expect(repo.query(OWNER_A, { severity: "medium" }).total).toBe(1);
    expect(repo.query(OWNER_A, { unreviewed: true }).total).toBe(1);
    expect(repo.countByOwner(OWNER_A)).toBe(1);
  });

  it("filters, orders most recently failed first, and pages", () => {
    const repo = getSecurityFindingRepository();
    repo.save(makeFinding({ id: "sf-1", scenarioId: "ss-1", latestFailedAt: T0, categoryId: "authentication" }));
    repo.save(makeFinding({ id: "sf-2", scenarioId: "ss-2", latestFailedAt: T1, categoryId: "input-validation", operationKey: "POST /orders" }));
    repo.save(makeFinding({ id: "sf-3", scenarioId: "ss-3", latestFailedAt: T1, assessmentKey: "other" }));
    expect(repo.query(OWNER_A, {}).items.map((f) => f.id)).toEqual(["sf-2", "sf-3", "sf-1"]);
    expect(repo.query(OWNER_A, { categoryId: "input-validation" }).items.map((f) => f.id)).toEqual(["sf-2"]);
    expect(repo.query(OWNER_A, { operationKey: "POST /orders" }).total).toBe(1);
    expect(repo.query(OWNER_A, { assessmentKey: "other" }).items.map((f) => f.id)).toEqual(["sf-3"]);
    expect(repo.query(OWNER_A, { scenarioId: "ss-1" }).items.map((f) => f.id)).toEqual(["sf-1"]);
    const page = repo.query(OWNER_A, {}, { page: 2, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.items.map((f) => f.id)).toEqual(["sf-1"]);
    expect(repo.listAll(OWNER_A, { assessmentKey: "assess-1" })).toHaveLength(2);
    expect(repo.query(OWNER_B, {}).total).toBe(0);
  });

  it("counts per assessment and deletes one assessment or everything for an owner", () => {
    const repo = getSecurityFindingRepository();
    repo.save(makeFinding({ id: "sf-1", scenarioId: "ss-1", assessmentKey: "k1" }));
    repo.save(makeFinding({ id: "sf-2", scenarioId: "ss-2", assessmentKey: "k1" }));
    repo.save(makeFinding({ id: "sf-3", scenarioId: "ss-3", assessmentKey: "k2" }));
    repo.save(makeFinding({ id: "sf-1", ownerId: OWNER_B, scenarioId: "ss-1", assessmentKey: "k1" }));
    expect(repo.countsByAssessment(OWNER_A).sort((a, b) => a.assessmentKey.localeCompare(b.assessmentKey))).toEqual([
      { assessmentKey: "k1", findings: 2 },
      { assessmentKey: "k2", findings: 1 },
    ]);
    expect(repo.deleteAssessment(OWNER_A, "k1")).toBe(2);
    expect(repo.countByOwner(OWNER_A)).toBe(1);
    expect(repo.deleteOwner(OWNER_A)).toBe(1);
    expect(repo.countByOwner(OWNER_B)).toBe(1);
  });
});
