import { describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getSecurityCredentialRepository, type CredentialKey } from "../../../src/persistence/securityCredentialRepository";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { ALL_SECRETS, SECRET_BEARER_TOKEN, SECRET_API_KEY } from "../../fixtures/securityLab/secretCorpus";

const KEY: CredentialKey = { profileId: "p-1", identity: "alice", scheme: "bearerAuth", kind: "active" };
const NOW = "2026-01-01T00:00:00.000Z";

describe("SecurityCredentialRepository (write-only session data)", () => {
  it("stores a value that only the sender's read can return", () => {
    const repo = getSecurityCredentialRepository();
    repo.set("s-1", KEY, SECRET_BEARER_TOKEN, NOW);
    expect(repo.isSet("s-1", KEY)).toBe(true);
    expect(repo.read("s-1", KEY)).toBe(SECRET_BEARER_TOKEN);
    expect(repo.read("s-2", KEY)).toBeUndefined();
    expect(repo.isSet("s-2", KEY)).toBe(false);
  });

  it("reports status without ever exposing a value", () => {
    const repo = getSecurityCredentialRepository();
    repo.set("s-1", KEY, SECRET_BEARER_TOKEN, NOW);
    repo.set("s-1", { ...KEY, identity: "bob", scheme: "apiKeyAuth" }, SECRET_API_KEY, NOW);
    const status = repo.listStatus("s-1", "p-1");
    expect(status).toEqual([
      { identity: "alice", scheme: "bearerAuth", kind: "active" },
      { identity: "bob", scheme: "apiKeyAuth", kind: "active" },
    ]);
    const serialised = JSON.stringify(status);
    for (const secret of ALL_SECRETS) expect(serialised).not.toContain(secret);
    expect(Object.keys(repo)).not.toContain("value");
  });

  it("is encrypted at rest", () => {
    const repo = getSecurityCredentialRepository();
    repo.set("s-1", KEY, SECRET_BEARER_TOKEN, NOW);
    const rows = getSharedConnection().db.prepare("SELECT * FROM security_credentials").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const raw = Buffer.concat([rows[0].value_encrypted as Buffer, rows[0].value_iv as Buffer]).toString("latin1");
    expect(raw).not.toContain(SECRET_BEARER_TOKEN);
    expect(JSON.stringify(rows[0])).not.toContain(SECRET_BEARER_TOKEN);
  });

  it("replaces a value in place, keeps active and expired kinds apart, and clears with an empty value", () => {
    const repo = getSecurityCredentialRepository();
    repo.set("s-1", KEY, "first", NOW);
    repo.set("s-1", KEY, "second", NOW);
    repo.set("s-1", { ...KEY, kind: "expired" }, "old-one", NOW);
    expect(repo.read("s-1", KEY)).toBe("second");
    expect(repo.read("s-1", { ...KEY, kind: "expired" })).toBe("old-one");
    expect(repo.listStatus("s-1", "p-1")).toHaveLength(2);
    repo.set("s-1", KEY, "", NOW);
    expect(repo.isSet("s-1", KEY)).toBe(false);
    expect(repo.isSet("s-1", { ...KEY, kind: "expired" })).toBe(true);
  });

  it("resolves everything a run needs in one pass, scoped to the session and profile", () => {
    const repo = getSecurityCredentialRepository();
    repo.set("s-1", KEY, "a", NOW);
    repo.set("s-1", { ...KEY, identity: "bob" }, "b", NOW);
    repo.set("s-1", { ...KEY, profileId: "p-2" }, "other-profile", NOW);
    repo.set("s-2", KEY, "other-session", NOW);
    expect(repo.readAllForRun("s-1", "p-1").map((c) => [c.identity, c.value])).toEqual([
      ["alice", "a"],
      ["bob", "b"],
    ]);
  });

  it("removes an identity's or a profile's credentials", () => {
    const repo = getSecurityCredentialRepository();
    repo.set("s-1", KEY, "a", NOW);
    repo.set("s-1", { ...KEY, identity: "bob" }, "b", NOW);
    repo.deleteByIdentity("s-1", "p-1", "alice");
    expect(repo.listStatus("s-1", "p-1").map((c) => c.identity)).toEqual(["bob"]);
    repo.deleteByProfile("s-1", "p-1");
    expect(repo.listStatus("s-1", "p-1")).toEqual([]);
  });

  it("is removed with the session when it expires, and only that session's", () => {
    const repo = getSecurityCredentialRepository();
    repo.set("s-1", KEY, "a", NOW);
    repo.set("s-2", KEY, "b", NOW);
    forceExpireForTest("s-1");
    expect(repo.isSet("s-1", KEY)).toBe(false);
    expect(repo.isSet("s-2", KEY)).toBe(true);
  });
});
