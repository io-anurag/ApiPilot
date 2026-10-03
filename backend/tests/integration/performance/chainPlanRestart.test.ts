import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteConnection, setSharedConnectionForTest } from "../../../src/persistence/connection";
import { SqliteChainPlanDataSetRepository } from "../../../src/persistence/chainPlanDataSetRepository";
import { SqliteChainPlanRepository } from "../../../src/persistence/chainPlanRepository";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T077; FR-039, SC-008): a saved plan survives a restart. */

const SESSION = "11111111-1111-4111-8111-111111111111";

describe("request-chain plans across a backend restart", () => {
  it("reopens the plan, its seeding report and its data sets unchanged from a file-backed database", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-chain-restart-"));
    const dbPath = path.join(dir, "apipilot.db");
    const content = Buffer.from("first_name,password\nAda,s1\nGrace,s2\n");
    const plan = customerLifecyclePlan({
      id: "p-restart",
      chains: [...customerLifecyclePlan().chains, { id: "c2", name: "Second chain", steps: [] }],
      seedingReport: { source: { kind: "specification", filename: "weak-spec.yaml" }, seededAt: "2026-10-03T10:00:00.000Z", items: [{ kind: "no-positive-scenario", sourceLabel: "GET /x", detail: "d", stepId: null }] },
    });
    try {
      const first = new SqliteConnection(dbPath);
      new SqliteChainPlanRepository(first).create(SESSION, plan);
      new SqliteChainPlanDataSetRepository(first).create(SESSION, { id: "d1", planId: plan.id, name: "Customers", mode: "row-per-iteration", columns: [{ name: "first_name", secret: false }, { name: "password", secret: true }], rowCount: 2, sizeBytes: content.length, sha256: "c".repeat(64), content, at: "t" });
      first.close();

      const second = new SqliteConnection(dbPath);
      setSharedConnectionForTest(second);
      expect(new SqliteChainPlanRepository(second).get(SESSION, plan.id)).toEqual({ ...plan, dataSets: [] });
      const dataSets = new SqliteChainPlanDataSetRepository(second);
      expect(dataSets.list(SESSION, plan.id)).toEqual([{ id: "d1", name: "Customers", mode: "row-per-iteration", columns: [{ name: "first_name", secret: false }, { name: "password", secret: true }], rowCount: 2, sizeBytes: content.length, sha256: "c".repeat(64) }]);
      expect(dataSets.content(SESSION, plan.id, "d1")).toEqual(content);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
