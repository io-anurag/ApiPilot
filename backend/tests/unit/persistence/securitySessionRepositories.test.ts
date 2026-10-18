import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "@apipilot/shared-domain";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getSecurityEvidenceRepository } from "../../../src/persistence/securityEvidenceRepository";
import { getSecurityProfileRepository } from "../../../src/persistence/securityProfileRepository";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { SECRET_BEARER_TOKEN } from "../../fixtures/securityLab/secretCorpus";
import { OWNER_A, makeProfile, makeResult, makeRun } from "../../fixtures/securityLab/builders";

const evidence = (index: number, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  index,
  sentAt: "2026-01-01T00:00:00.000Z",
  durationMs: 5,
  method: "GET",
  urlRedacted: "http://127.0.0.1:4700/orders",
  requestHeadersRedacted: { authorization: "[redacted]" },
  destination: { host: "127.0.0.1", port: 4700, addressClass: "loopback", verdict: "allowed" },
  redirects: [],
  responseStatus: 200,
  responseHeadersSelected: {},
  responseBodyExcerpt: '{"orders":[]}',
  truncated: false,
  ...overrides,
});

describe("SecurityProfileRepository (session data)", () => {
  it("stores profiles per session and never shows one session's profile to another", () => {
    const repo = getSecurityProfileRepository();
    repo.create("s-1", makeProfile({ id: "p-1", name: "b" }));
    repo.create("s-1", makeProfile({ id: "p-2", name: "a" }));
    repo.create("s-2", makeProfile({ id: "p-3", name: "a" }));
    expect(repo.list("s-1").map((p) => p.id)).toEqual(["p-2", "p-1"]);
    expect(repo.get("s-2", "p-1")).toBeUndefined();
    expect(repo.findByName("s-1", "a")?.id).toBe("p-2");
    expect(repo.findByName("s-1", "zzz")).toBeUndefined();
  });

  it("updates and deletes a profile", () => {
    const repo = getSecurityProfileRepository();
    repo.create("s-1", makeProfile({ id: "p-1" }));
    repo.update("s-1", makeProfile({ id: "p-1", name: "renamed", maxRequests: 7, updatedAt: "2026-02-02T00:00:00.000Z" }));
    expect(repo.get("s-1", "p-1")).toMatchObject({ name: "renamed", maxRequests: 7 });
    expect(repo.delete("s-2", "p-1")).toBe(false);
    expect(repo.delete("s-1", "p-1")).toBe(true);
    expect(repo.list("s-1")).toEqual([]);
  });

  it("is removed with the session when it expires, and only that session's", () => {
    const repo = getSecurityProfileRepository();
    repo.create("s-1", makeProfile({ id: "p-1" }));
    repo.create("s-2", makeProfile({ id: "p-2", name: "other" }));
    forceExpireForTest("s-1");
    expect(repo.list("s-1")).toEqual([]);
    expect(repo.list("s-2")).toHaveLength(1);
  });
});

describe("SecurityEvidenceRepository (session data)", () => {
  it("returns evidence in the order sent, scoped to the session", () => {
    const repo = getSecurityEvidenceRepository();
    repo.add("s-1", OWNER_A, "run-1", "result-1", 1, evidence(1));
    repo.add("s-1", OWNER_A, "run-1", "result-1", 0, evidence(0));
    expect(repo.list("s-1", "result-1").map((e) => e.index)).toEqual([0, 1]);
    expect(repo.list("s-2", "result-1")).toEqual([]);
    expect(repo.has("s-1", "result-1")).toBe(true);
    expect(repo.has("s-2", "result-1")).toBe(false);
  });

  it("is encrypted at rest: neither the body excerpt nor a seeded value appears in the stored row", () => {
    const repo = getSecurityEvidenceRepository();
    repo.add("s-1", OWNER_A, "run-1", "result-1", 0, evidence(0, { responseBodyExcerpt: `{"note":"${SECRET_BEARER_TOKEN}"}` }));
    const stored = getSharedConnection().db.prepare("SELECT * FROM security_evidence").all() as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    const raw = Buffer.concat([stored[0].evidence_encrypted as Buffer, stored[0].evidence_iv as Buffer]).toString("latin1");
    expect(raw).not.toContain(SECRET_BEARER_TOKEN);
    expect(raw).not.toContain("orders");
    expect(repo.list("s-1", "result-1")[0]?.responseBodyExcerpt).toContain(SECRET_BEARER_TOKEN);
  });

  it("reports which results still have evidence, across more than one query chunk", () => {
    const repo = getSecurityEvidenceRepository();
    repo.add("s-1", OWNER_A, "run-1", "result-2", 0, evidence(0));
    const ids = Array.from({ length: 1200 }, (_, i) => `result-missing-${i}`);
    ids.push("result-2");
    expect([...repo.availableResultIds("s-1", ids)]).toEqual(["result-2"]);
    expect(repo.availableResultIds("s-1", []).size).toBe(0);
  });

  it("is removed with the session, while the retained result summary stays", () => {
    const evidenceRepo = getSecurityEvidenceRepository();
    const runRepo = getSecurityRunRepository();
    runRepo.createRun(makeRun({ sessionId: "s-1" }));
    runRepo.appendResult(OWNER_A, makeResult());
    evidenceRepo.add("s-1", OWNER_A, "run-1", "result-1", 0, evidence(0));
    forceExpireForTest("s-1");
    expect(evidenceRepo.has("s-1", "result-1")).toBe(false);
    expect(runRepo.getResult(OWNER_A, "result-1")?.observed.statement).toBe("status 200");
    expect(runRepo.getRun(OWNER_A, "run-1")).toBeDefined();
  });

  it("deletes an owner's evidence in every session, or by run", () => {
    const repo = getSecurityEvidenceRepository();
    repo.add("s-1", OWNER_A, "run-1", "r-1", 0, evidence(0));
    repo.add("s-2", OWNER_A, "run-2", "r-2", 0, evidence(0));
    repo.add("s-3", "someone-else", "run-3", "r-3", 0, evidence(0));
    expect(repo.deleteByRuns(["run-1"])).toBe(1);
    expect(repo.deleteByOwner(OWNER_A)).toBe(1);
    expect(repo.has("s-3", "r-3")).toBe(true);
  });
});
