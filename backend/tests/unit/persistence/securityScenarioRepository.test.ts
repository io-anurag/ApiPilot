import { describe, expect, it } from "vitest";
import type { SecurityScenario } from "@apipilot/shared-domain";
import { getSecurityScenarioRepository, type ScenarioHead } from "../../../src/persistence/securityScenarioRepository";
import { OWNER_A, OWNER_B, T0, T1, makeContent, makeScenario, makeVersion } from "../../fixtures/securityLab/builders";

const head = (overrides: Partial<ScenarioHead> = {}): ScenarioHead => ({
  operationKey: "GET /orders",
  categoryId: "authentication",
  severity: "high",
  destructive: false,
  title: "GET /orders without credentials",
  ...overrides,
});

function seed(ownerId: string, id: string, overrides: Partial<ScenarioHead> = {}, scenario: Partial<SecurityScenario> = {}) {
  const repo = getSecurityScenarioRepository();
  repo.insertScenario(makeScenario({ id, ownerId, ...scenario }), head(overrides), T0);
  repo.insertVersion(ownerId, makeVersion({ scenarioId: id, content: makeContent({ title: head(overrides).title }) }));
}

describe("SecurityScenarioRepository", () => {
  it("stores a scenario head and its immutable first version, owner-scoped", () => {
    const repo = getSecurityScenarioRepository();
    seed(OWNER_A, "ss-1");
    expect(repo.getScenario(OWNER_A, "ss-1")).toMatchObject({ id: "ss-1", ownerId: OWNER_A, currentVersion: 1, reviewState: "draft" });
    expect(repo.getScenario(OWNER_B, "ss-1")).toBeUndefined();
    expect(repo.getVersion(OWNER_A, "ss-1", 1)?.content.title).toBe("GET /orders without credentials");
    expect(repo.getVersion(OWNER_B, "ss-1", 1)).toBeUndefined();
  });

  it("lets two owners hold the same content-derived id without seeing each other", () => {
    const repo = getSecurityScenarioRepository();
    seed(OWNER_A, "ss-same");
    seed(OWNER_B, "ss-same", { title: "other owner" });
    expect(repo.getScenario(OWNER_A, "ss-same")?.title).toBe("GET /orders without credentials");
    expect(repo.getScenario(OWNER_B, "ss-same")?.title).toBe("other owner");
    expect(repo.countByOwner(OWNER_A)).toBe(1);
  });

  it("never overwrites a version: inserting version 1 twice fails", () => {
    const repo = getSecurityScenarioRepository();
    seed(OWNER_A, "ss-1");
    expect(() => repo.insertVersion(OWNER_A, makeVersion({ scenarioId: "ss-1" }))).toThrow();
  });

  it("records an approval or rejection on a version without changing its content", () => {
    const repo = getSecurityScenarioRepository();
    seed(OWNER_A, "ss-1");
    const approval = { version: 1, contentHash: "h".repeat(64), approvedAt: T1, actor: "tester", destructiveConfirmed: false };
    repo.setApproval(OWNER_A, "ss-1", 1, approval);
    expect(repo.getVersion(OWNER_A, "ss-1", 1)?.approval).toEqual(approval);
    repo.setApproval(OWNER_A, "ss-1", 1, undefined);
    expect(repo.getVersion(OWNER_A, "ss-1", 1)?.approval).toBeUndefined();
    repo.setRejection(OWNER_A, "ss-1", 1, { reason: "out of scope", at: T1 });
    expect(repo.getVersion(OWNER_A, "ss-1", 1)?.rejection).toEqual({ reason: "out of scope", at: T1 });
    expect(repo.getVersion(OWNER_A, "ss-1", 1)?.content.title).toBe("GET /orders without credentials");
  });

  it("lists versions in ascending order and updates the head to the newest", () => {
    const repo = getSecurityScenarioRepository();
    seed(OWNER_A, "ss-1");
    repo.insertVersion(OWNER_A, makeVersion({ scenarioId: "ss-1", version: 2, materialChange: true, editNote: "changed request" }));
    repo.updateHead(OWNER_A, "ss-1", { currentVersion: 2, reviewState: "in_review", updatedAt: T1 });
    expect(repo.listVersions(OWNER_A, "ss-1").map((v) => v.version)).toEqual([1, 2]);
    expect(repo.getScenario(OWNER_A, "ss-1")).toMatchObject({ currentVersion: 2, reviewState: "in_review", updatedAt: T1 });
    expect(repo.getVersion(OWNER_A, "ss-1", 2)).toMatchObject({ materialChange: true, editNote: "changed request" });
  });

  it("filters by every list column, searches literally, and pages in a stable order", () => {
    const repo = getSecurityScenarioRepository();
    seed(OWNER_A, "ss-1", { operationKey: "GET /orders", categoryId: "authentication", severity: "high", title: "alpha" });
    seed(OWNER_A, "ss-2", { operationKey: "GET /orders", categoryId: "input-validation", severity: "low", title: "50% off_deal" });
    seed(
      OWNER_A,
      "ss-3",
      { operationKey: "POST /orders", categoryId: "authentication", severity: "high", destructive: true, title: "gamma" },
      { reviewState: "approved", executionStatus: "evaluated" },
    );
    expect(repo.query(OWNER_A, {}).total).toBe(3);
    expect(repo.query(OWNER_A, { categoryId: "authentication" }).items.map((s) => s.id)).toEqual(["ss-1", "ss-3"]);
    expect(repo.query(OWNER_A, { severity: "low" }).items.map((s) => s.id)).toEqual(["ss-2"]);
    expect(repo.query(OWNER_A, { reviewState: "approved" }).items.map((s) => s.id)).toEqual(["ss-3"]);
    expect(repo.query(OWNER_A, { executionStatus: "evaluated" }).items.map((s) => s.id)).toEqual(["ss-3"]);
    expect(repo.query(OWNER_A, { destructive: true }).items.map((s) => s.id)).toEqual(["ss-3"]);
    expect(repo.query(OWNER_A, { operationKey: "POST /orders" }).total).toBe(1);
    expect(repo.query(OWNER_A, { q: "50%" }).items.map((s) => s.id)).toEqual(["ss-2"]);
    expect(repo.query(OWNER_A, { q: "%" }).items.map((s) => s.id)).toEqual(["ss-2"]);
    expect(repo.query(OWNER_A, { q: "_deal" }).items.map((s) => s.id)).toEqual(["ss-2"]);
    expect(repo.query(OWNER_A, { ids: ["ss-1", "ss-3"] }).total).toBe(2);
    expect(repo.query(OWNER_A, { ids: [] }).total).toBe(0);
    const page2 = repo.query(OWNER_A, {}, { page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items.map((s) => s.id)).toEqual(["ss-3"]);
    expect(repo.query(OWNER_B, {}).total).toBe(0);
  });

  it("caps listHeads", () => {
    const repo = getSecurityScenarioRepository();
    for (let i = 1; i <= 5; i += 1) seed(OWNER_A, `ss-${i}`);
    expect(repo.listHeads(OWNER_A, {}, 3)).toHaveLength(3);
    expect(repo.listHeads(OWNER_A, {})).toHaveLength(5);
  });

  it("groups assessments and deletes one assessment, or everything for an owner, in one step", () => {
    const repo = getSecurityScenarioRepository();
    seed(OWNER_A, "ss-1", {}, { assessmentKey: "k1", assessmentLabel: "API One" });
    seed(OWNER_A, "ss-2", {}, { assessmentKey: "k1", assessmentLabel: "API One" });
    seed(OWNER_A, "ss-3", {}, { assessmentKey: "k2", assessmentLabel: "API Two" });
    seed(OWNER_B, "ss-1", {}, { assessmentKey: "k1", assessmentLabel: "API One" });
    expect(repo.listAssessments(OWNER_A)).toEqual([
      { assessmentKey: "k1", assessmentLabel: "API One", scenarios: 2 },
      { assessmentKey: "k2", assessmentLabel: "API Two", scenarios: 1 },
    ]);
    expect(repo.deleteAssessment(OWNER_A, "k1")).toBe(2);
    expect(repo.getScenario(OWNER_A, "ss-1")).toBeUndefined();
    expect(repo.getVersion(OWNER_A, "ss-1", 1)).toBeUndefined();
    expect(repo.getScenario(OWNER_A, "ss-3")).toBeDefined();
    expect(repo.getScenario(OWNER_B, "ss-1")).toBeDefined();
    expect(repo.deleteOwner(OWNER_A)).toBe(1);
    expect(repo.countByOwner(OWNER_A)).toBe(0);
    expect(repo.getScenario(OWNER_B, "ss-1")).toBeDefined();
  });
});
