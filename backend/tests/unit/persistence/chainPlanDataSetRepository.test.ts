import { describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getChainPlanDataSetRepository } from "../../../src/persistence/chainPlanDataSetRepository";
import { getChainPlanRepository } from "../../../src/persistence/chainPlanRepository";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T077; FR-044, FR-046; research R14). */

const SESSION = "11111111-1111-4111-8111-111111111111";
const CONTENT = Buffer.from("name,password\r\nAda,SECRET-CELL-91a\r\n", "utf-8");

function dataSet(id: string, planId = "p1") {
  return { id, planId, name: `Set ${id}`, mode: "row-per-iteration" as const, columns: [{ name: `col_${id}`, secret: id === "d1" }], rowCount: 1, sizeBytes: CONTENT.length, sha256: "a".repeat(64), content: CONTENT, at: "2026-10-03T10:00:00.000Z" };
}

describe("chainPlanDataSetRepository", () => {
  it("stores the file encrypted, keeps names, counts and hashes plain, and lists in order", () => {
    const repository = getChainPlanDataSetRepository();
    repository.create(SESSION, dataSet("d1"));
    repository.create(SESSION, dataSet("d2"));
    expect(repository.list(SESSION, "p1").map((entry) => [entry.id, entry.columns])).toEqual([
      ["d1", [{ name: "col_d1", secret: true }]],
      ["d2", [{ name: "col_d2", secret: false }]],
    ]);
    const raw = JSON.stringify(getSharedConnection().db.prepare("SELECT * FROM chain_plan_data_sets").all(), (_key, value: unknown) => (Buffer.isBuffer(value) ? value.toString("latin1") : value));
    expect(raw).not.toContain("SECRET-CELL-91a");
    expect(raw).toContain("col_d1");
    expect(repository.content(SESSION, "p1", "d1")).toEqual(CONTENT);
    expect(repository.content("other-session", "p1", "d1")).toBeUndefined();
  });

  it("updates names and secret marks, replaces content, copies and deletes", () => {
    const repository = getChainPlanDataSetRepository();
    repository.create(SESSION, dataSet("d1"));
    repository.updateMeta(SESSION, "p1", "d1", { name: "Renamed", mode: "row-per-virtual-user", columns: [{ name: "first", secret: false }] }, "t");
    expect(repository.list(SESSION, "p1")[0]).toMatchObject({ name: "Renamed", mode: "row-per-virtual-user", columns: [{ name: "first", secret: false }] });
    const next = Buffer.from("first\nGrace\n");
    repository.replaceContent(SESSION, "p1", "d1", { columns: [{ name: "first", secret: false }], rowCount: 1, sizeBytes: next.length, sha256: "b".repeat(64), content: next }, "t");
    expect(repository.content(SESSION, "p1", "d1")).toEqual(next);
    expect(repository.copy(SESSION, "p1", "d1", "p2", "d9", "t")).toBe(true);
    expect(repository.list(SESSION, "p2")[0]).toMatchObject({ id: "d9", name: "Renamed", sha256: "b".repeat(64) });
    expect(repository.copy(SESSION, "p1", "missing", "p2", "d8", "t")).toBe(false);
    repository.delete(SESSION, "p1", "d1");
    expect(repository.count(SESSION, "p1")).toBe(0);
  });

  it("is removed with its plan and with its session", () => {
    const plans = getChainPlanRepository();
    plans.create(SESSION, customerLifecyclePlan({ id: "p1" }));
    getChainPlanDataSetRepository().create(SESSION, dataSet("d1"));
    plans.delete(SESSION, "p1");
    expect(getChainPlanDataSetRepository().count(SESSION, "p1")).toBe(0);
    getChainPlanDataSetRepository().create(SESSION, dataSet("d2", "p3"));
    plans.deleteBySession(SESSION);
    expect(getChainPlanDataSetRepository().count(SESSION, "p3")).toBe(0);
  });
});
