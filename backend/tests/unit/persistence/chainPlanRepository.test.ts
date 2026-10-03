import { describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getChainPlanRepository } from "../../../src/persistence/chainPlanRepository";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T012; research R2): request-chain plan storage. */

const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function rawRow(id: string): Record<string, unknown> {
  return getSharedConnection().db.prepare("SELECT * FROM chain_plans WHERE id = ?").get(id) as Record<string, unknown>;
}

describe("chainPlanRepository", () => {
  it("creates, reads and lists plans per session, newest first", () => {
    const repository = getChainPlanRepository();
    const first = customerLifecyclePlan({ id: "p1", updatedAt: "2026-10-03T10:00:00.000Z" });
    const second = customerLifecyclePlan({ id: "p2", name: "Second", updatedAt: "2026-10-03T11:00:00.000Z", seedingReport: { source: { kind: "specification", filename: "a.yaml" }, seededAt: "2026-10-03T11:00:00.000Z", items: [] } });
    repository.create(SESSION, first);
    repository.create(SESSION, second);
    repository.create(OTHER, customerLifecyclePlan({ id: "p3" }));

    expect(repository.get(SESSION, "p1")).toEqual(first);
    expect(repository.get(OTHER, "p1")).toBeUndefined();
    expect(repository.list(SESSION)).toEqual([
      { id: "p2", name: "Second", chainCount: 1, stepCount: 7, dataSetCount: 0, seedSource: "specification", updatedAt: "2026-10-03T11:00:00.000Z" },
      { id: "p1", name: "Customer lifecycle", chainCount: 1, stepCount: 7, dataSetCount: 0, seedSource: null, updatedAt: "2026-10-03T10:00:00.000Z" },
    ]);
  });

  it("encrypts the document, so no step URL or header value is readable in the row", () => {
    getChainPlanRepository().create(SESSION, customerLifecyclePlan({ id: "p1" }));
    const row = JSON.stringify(rawRow("p1"), (_key, value: unknown) => (Buffer.isBuffer(value) ? value.toString("latin1") : value));
    expect(row).not.toContain("/api/v1/customers");
    expect(row).not.toContain("Bearer {{token}}");
    expect(row).toContain("Customer lifecycle");
  });

  it("saves only at the expected revision, and reports the current plan otherwise", () => {
    const repository = getChainPlanRepository();
    const plan = customerLifecyclePlan({ id: "p1", revision: 1 });
    repository.create(SESSION, plan);

    const saved = repository.save(SESSION, { ...plan, name: "Renamed", revision: 2 }, 1);
    expect(saved).toEqual({ ok: true });
    const stale = repository.save(SESSION, { ...plan, name: "Lost", revision: 2 }, 1);
    expect(stale.ok).toBe(false);
    expect(stale.ok === false && stale.current?.name).toBe("Renamed");
    expect(repository.get(SESSION, "p1")?.revision).toBe(2);
    expect(repository.save(OTHER, { ...plan, revision: 3 }, 2)).toEqual({ ok: false, current: undefined });
  });

  it("never stores data set metadata in the document", () => {
    const repository = getChainPlanRepository();
    repository.create(SESSION, customerLifecyclePlan({ id: "p1", dataSets: [{ id: "d1", name: "x", mode: "row-per-iteration", columns: [], rowCount: 0, sizeBytes: 0, sha256: "" }] }));
    expect(repository.get(SESSION, "p1")?.dataSets).toEqual([]);
  });

  it("deletes a plan with its data sets, and a session's plans", () => {
    const repository = getChainPlanRepository();
    const db = getSharedConnection().db;
    repository.create(SESSION, customerLifecyclePlan({ id: "p1" }));
    repository.create(SESSION, customerLifecyclePlan({ id: "p2" }));
    db.prepare(
      `INSERT INTO chain_plan_data_sets (id, plan_id, session_id, position, name, mode, columns, row_count, size_bytes, sha256, content_encrypted, content_iv, created_at, updated_at)
       VALUES ('d1', 'p1', ?, 0, 'd', 'row-per-iteration', '[]', 0, 0, '', x'00', x'00', '', '')`,
    ).run(SESSION);

    repository.delete(SESSION, "p1");
    expect(repository.get(SESSION, "p1")).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM chain_plan_data_sets").get()).toEqual({ n: 0 });
    expect(repository.count(SESSION)).toBe(1);

    repository.deleteBySession(SESSION);
    expect(repository.list(SESSION)).toEqual([]);
  });
});
