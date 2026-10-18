import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getSecurityCredentialRepository } from "../../../src/persistence/securityCredentialRepository";
import { getSecurityProfileRepository } from "../../../src/persistence/securityProfileRepository";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { makeRun } from "../../fixtures/securityLab/builders";
import { ALL_SECRETS, SECRET_BEARER_TOKEN, SECRET_API_KEY, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

const BASE = "/api/security-lab";
const FIXTURES = path.resolve(__dirname, "../../fixtures/securityLab");
type Agent = ReturnType<typeof request.agent>;
type Resolver = (hostname: string) => Promise<string[]>;

const PUBLIC_ADDRESS = "93.184.216.34";

function appWith(resolveName: Resolver = async () => [PUBLIC_ADDRESS]) {
  return createApp(undefined, { securityLab: { resolveName } });
}

/** An agent plus the session id the server issued it, read from the cookie it set. */
async function session(app = appWith()): Promise<{ agent: Agent; sessionId: string }> {
  const agent = request.agent(app);
  const res = await agent.get(`${BASE}/profiles`);
  const cookie = (res.headers["set-cookie"] as unknown as string[]).find((entry) => entry.startsWith("sessionId="));
  return { agent, sessionId: decodeURIComponent((cookie as string).split(";")[0].split("=")[1]) };
}

async function environment(agent: Agent, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await agent.post(`${BASE}/environments`).send({ name: "Staging", tier: "staging", baseUrl: "https://api.example.test", ...overrides });
  expect(res.status).toBe(200);
  return res.body.environment;
}

const profileBody = (environmentId: string, overrides: Record<string, unknown> = {}) => ({
  name: "Staging run",
  environmentId,
  allowedHosts: ["api.example.test"],
  allowedPorts: [443],
  permittedCategories: ["authentication"],
  identities: [
    { name: "alice", role: "owner", credentialSchemes: ["bearerAuth"], expiredCredentialSchemes: ["bearerAuth"] },
    { name: "bob", role: "other-user", credentialSchemes: ["bearerAuth", "apiKeyAuth"] },
  ],
  ...overrides,
});

async function createProfile(agent: Agent, overrides: Record<string, unknown> = {}, env?: { id: string }) {
  const target = env ?? (await environment(agent));
  const res = await agent.post(`${BASE}/profiles`).send(profileBody(target.id, overrides));
  expect(res.status).toBe(201);
  return res.body as { profile: { id: string; createdAt: string; updatedAt: string }; credentialStatus: unknown[]; valid: boolean; problems: unknown[] };
}

describe("profile create, read, update, delete", () => {
  it("answers 201 with the profile, its credential status and its validity, and lists it", async () => {
    const { agent } = await session();
    const created = await createProfile(agent);
    expect(created.valid).toBe(true);
    expect(created.problems).toEqual([]);
    expect(created.credentialStatus).toEqual([
      { identity: "alice", scheme: "bearerAuth", kind: "active", set: false },
      { identity: "alice", scheme: "bearerAuth", kind: "expired", set: false },
      { identity: "bob", scheme: "bearerAuth", kind: "active", set: false },
      { identity: "bob", scheme: "apiKeyAuth", kind: "active", set: false },
    ]);
    expect(created.profile).toMatchObject({ name: "Staging run", tlsPolicy: "verify", timeoutMs: 10_000, maxRequests: 100, maxConcurrency: 1, destructivePermitted: false, cleanup: { strategy: "none" } });

    const list = await agent.get(`${BASE}/profiles`);
    expect(list.status).toBe(200);
    expect(list.body.profiles).toHaveLength(1);
    expect(list.body.profiles[0]).toMatchObject({ valid: true, environment: { name: "Staging", tier: "staging", baseUrl: "https://api.example.test" } });
    expect(list.headers["cache-control"]).toBe("no-store");
  });

  it("works with no specification loaded, and does not check scheme names then", async () => {
    const { agent } = await session();
    const created = await createProfile(agent, { identities: [{ name: "alice", role: "owner", credentialSchemes: ["anything"] }] });
    expect(created.valid).toBe(true);
  });

  it("checks scheme names against the loaded specification, and reports an earlier profile as invalid once a specification disagrees", async () => {
    const { agent } = await session();
    await createProfile(agent, { identities: [{ name: "alice", role: "owner", credentialSchemes: ["notInTheSpec"] }] });
    await agent.post("/api/test-generation-workflow").attach("file", readFileSync(path.join(FIXTURES, "sample-api.yaml")), "sample-api.yaml");
    const [only] = (await agent.get(`${BASE}/profiles`)).body.profiles;
    expect(only.valid).toBe(false);
    expect(only.problems.map((p: { code: string }) => p.code)).toEqual(["identity_scheme_unknown"]);

    const other = await environment(agent, { name: "Other" });
    const refused = await agent.post(`${BASE}/profiles`).send(profileBody(other.id, { name: "Second", identities: [{ name: "alice", role: "owner", credentialSchemes: ["notInTheSpec"] }] }));
    expect(refused.status).toBe(422);
    expect(refused.body.violations[0]).toMatchObject({ code: "identity_scheme_unknown", field: "identities[0].credentialSchemes[0]" });
  });

  it("replaces a profile with PUT, keeping its id and creation time", async () => {
    const { agent } = await session();
    const env = await environment(agent);
    const created = await createProfile(agent, {}, env);
    const res = await agent.put(`${BASE}/profiles/${created.profile.id}`).send(profileBody(env.id, { name: "Renamed", maxRequests: 50 }));
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ id: created.profile.id, name: "Renamed", maxRequests: 50 });
    expect(res.body.profile.createdAt).toBe(created.profile.createdAt);
    expect((await agent.get(`${BASE}/profiles`)).body.profiles).toHaveLength(1);
  });

  it("deletes with 204, removes the profile's credentials, and answers 404 afterwards", async () => {
    const { agent, sessionId } = await session();
    const created = await createProfile(agent);
    await agent.put(`${BASE}/profiles/${created.profile.id}/credentials`).send({ identity: "alice", scheme: "bearerAuth", kind: "active", value: SECRET_BEARER_TOKEN });
    expect(getSecurityCredentialRepository().listStatus(sessionId, created.profile.id)).toHaveLength(1);

    const res = await agent.delete(`${BASE}/profiles/${created.profile.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(getSecurityCredentialRepository().listStatus(sessionId, created.profile.id)).toEqual([]);
    expect((await agent.delete(`${BASE}/profiles/${created.profile.id}`)).status).toBe(404);
    expect((await agent.put(`${BASE}/profiles/${created.profile.id}`).send(profileBody("x"))).status).toBe(404);
  });

  it("refuses a duplicate name within a session, but allows the same name in another session", async () => {
    const app = appWith();
    const first = await session(app);
    await createProfile(first.agent);
    const env = await environment(first.agent, { name: "Another" });
    const duplicate = await first.agent.post(`${BASE}/profiles`).send(profileBody(env.id));
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.violations.map((v: { code: string }) => v.code)).toEqual(["name_duplicate"]);

    const second = await session(app);
    await createProfile(second.agent);
  });

  it("keeps each session's profiles apart", async () => {
    const app = appWith();
    const first = await session(app);
    await createProfile(first.agent);
    const second = await session(app);
    expect((await second.agent.get(`${BASE}/profiles`)).body.profiles).toEqual([]);
    const id = (await first.agent.get(`${BASE}/profiles`)).body.profiles[0].profile.id;
    expect((await second.agent.delete(`${BASE}/profiles/${id}`)).status).toBe(404);
    expect((await second.agent.get(`${BASE}/profiles/${id}/credentials`)).status).toBe(404);
  });
});

describe("refusals", () => {
  it("refuses a production target with 422 profile_invalid and a coded violation, and stores nothing", async () => {
    const { agent } = await session();
    const production = await environment(agent, { name: "Prod", tier: "production" });
    const res = await agent.post(`${BASE}/profiles`).send(profileBody(production.id));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("profile_invalid");
    expect(res.body.violations).toEqual([expect.objectContaining({ code: "production_tier_refused", field: "environmentId" })]);
    expect((await agent.get(`${BASE}/profiles`)).body.profiles).toEqual([]);
  });

  it("reports an existing profile as invalid when its target is later changed to production, and refuses to use it", async () => {
    const { agent } = await session();
    const env = await environment(agent);
    await createProfile(agent, {}, env);
    await agent.put(`${BASE}/environments/${env.id}`).send({ name: "Staging", tier: "production", baseUrl: "https://api.example.test" });
    const [only] = (await agent.get(`${BASE}/profiles`)).body.profiles;
    expect(only).toMatchObject({ valid: false });
    expect(only.problems.map((p: { code: string }) => p.code)).toEqual(["production_tier_refused"]);
  });

  it("reports every violation together", async () => {
    const { agent } = await session();
    const env = await environment(agent);
    const res = await agent.post(`${BASE}/profiles`).send(
      profileBody(env.id, { tlsPolicy: "relaxed-local", allowedAddressRanges: ["10.0.0.0/8"], maxRequests: 1_000_000, allowedHosts: ["api.example.test", "*.example.test"], permittedCategories: ["nope"] }),
    );
    expect(res.status).toBe(422);
    expect(res.body.violations.map((v: { code: string }) => v.code).sort()).toEqual([
      "address_ranges_local_only",
      "allowed_host_invalid",
      "limit_above_ceiling",
      "relaxed_tls_local_only",
      "unknown_category",
    ]);
  });

  it("answers 404 environment_not_found for a target that does not exist", async () => {
    const { agent } = await session();
    const res = await agent.post(`${BASE}/profiles`).send(profileBody("no-such-environment"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("environment_not_found");
  });

  it.each([
    [{ name: "" }],
    [{ allowedPorts: [0] }],
    [{ allowedHosts: "api.example.test" }],
    [{ tlsPolicy: "off" }],
    [{ surprise: true }],
    [{ identities: [{ name: "alice", role: "owner", credentialSchemes: [], token: "x" }] }],
  ])("refuses the malformed body %j with 400 invalid_request", async (overrides) => {
    const { agent } = await session();
    const env = await environment(agent);
    const res = await agent.post(`${BASE}/profiles`).send(profileBody(env.id, overrides));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("refuses a credential smuggled into the profile body, naming the right route and never echoing the value", async () => {
    const { agent } = await session();
    const env = await environment(agent);
    const res = await agent.post(`${BASE}/profiles`).send(profileBody(env.id, { identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"], password: SECRET_BEARER_TOKEN }] }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/credentials route/);
    assertNoSecrets("profile refusal", JSON.stringify(res.body));
  });

  it("refuses credential-shaped test data without echoing it", async () => {
    const { agent } = await session();
    const env = await environment(agent);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2VlZHNlZWRzZWVk";
    const res = await agent.post(`${BASE}/profiles`).send(profileBody(env.id, { testData: [{ ownerIdentity: "alice", parameter: "orderId", value: jwt }] }));
    expect(res.status).toBe(422);
    expect(res.body.violations[0]).toMatchObject({ code: "test_data_credential_shaped", field: "testData[0].value" });
    expect(JSON.stringify(res.body)).not.toContain(jwt);
  });
});

describe("profile_in_use", () => {
  it("refuses to update or delete a profile while a run of this session uses it, and allows it again afterwards", async () => {
    const { agent, sessionId } = await session();
    const env = await environment(agent);
    const created = await createProfile(agent, {}, env);
    const run = makeRun({ id: "run-in-use", sessionId, status: "in-progress", profileSummary: { ...makeRun().profileSummary, profileId: created.profile.id } });
    getSecurityRunRepository().createRun(run);

    const deleted = await agent.delete(`${BASE}/profiles/${created.profile.id}`);
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toBe("profile_in_use");
    const updated = await agent.put(`${BASE}/profiles/${created.profile.id}`).send(profileBody(env.id, { name: "Renamed" }));
    expect(updated.status).toBe(409);
    expect((await agent.get(`${BASE}/profiles`)).body.profiles).toHaveLength(1);

    getSecurityRunRepository().updateRun(run.ownerId, run.id, { status: "completed", completedAt: "2026-01-01T00:00:00.000Z" });
    expect((await agent.delete(`${BASE}/profiles/${created.profile.id}`)).status).toBe(204);
  });

  it("does not block a different profile, nor another session's run", async () => {
    const app = appWith();
    const first = await session(app);
    const env = await environment(first.agent);
    const used = await createProfile(first.agent, {}, env);
    const other = await first.agent.post(`${BASE}/profiles`).send(profileBody(env.id, { name: "Other profile" }));
    getSecurityRunRepository().createRun(makeRun({ id: "run-a", sessionId: first.sessionId, status: "in-progress", profileSummary: { ...makeRun().profileSummary, profileId: used.profile.id } }));
    expect((await first.agent.delete(`${BASE}/profiles/${other.body.profile.id}`)).status).toBe(204);
  });
});

describe("credentials are write-only", () => {
  it("accepts a value with 204, reports only that it is set, and never returns it from any route", async () => {
    const { agent } = await session();
    const created = await createProfile(agent);
    const id = created.profile.id;

    for (const [identity, scheme, kind, value] of [
      ["alice", "bearerAuth", "active", SECRET_BEARER_TOKEN],
      ["bob", "apiKeyAuth", "active", SECRET_API_KEY],
    ]) {
      const put = await agent.put(`${BASE}/profiles/${id}/credentials`).send({ identity, scheme, kind, value });
      expect(put.status).toBe(204);
      expect(put.text).toBe("");
    }

    const status = await agent.get(`${BASE}/profiles/${id}/credentials`);
    expect(status.status).toBe(200);
    expect(status.body.credentialStatus.filter((entry: { set: boolean }) => entry.set).map((entry: { identity: string; scheme: string; kind: string }) => `${entry.identity}/${entry.scheme}/${entry.kind}`)).toEqual([
      "alice/bearerAuth/active",
      "bob/apiKeyAuth/active",
    ]);

    // Every route that could carry a profile, as the browser sees it, holds no value.
    const listed = await agent.get(`${BASE}/profiles`);
    const replaced = await agent.put(`${BASE}/profiles/${id}`).send(profileBody(listed.body.profiles[0].profile.environmentId));
    const checked = await agent.post(`${BASE}/profiles/${id}/check`);
    const environments = await agent.get(`${BASE}/environments`);
    const everything = [status.text, listed.text, replaced.text, checked.text, environments.text].join("\n");
    assertNoSecrets("profile routes", everything, ALL_SECRETS);
  });

  it("encrypts the stored value", async () => {
    const { agent } = await session();
    const created = await createProfile(agent);
    await agent.put(`${BASE}/profiles/${created.profile.id}/credentials`).send({ identity: "alice", scheme: "bearerAuth", kind: "active", value: SECRET_BEARER_TOKEN });
    const rows = getSharedConnection().db.prepare("SELECT value_encrypted FROM security_credentials").all() as Array<{ value_encrypted: Buffer }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].value_encrypted.toString("utf8")).not.toContain(SECRET_BEARER_TOKEN);
  });

  it("clears a credential with an empty value, and replaces one with a new value", async () => {
    const { agent, sessionId } = await session();
    const created = await createProfile(agent);
    const id = created.profile.id;
    const send = (value: string) => agent.put(`${BASE}/profiles/${id}/credentials`).send({ identity: "alice", scheme: "bearerAuth", kind: "active", value });
    await send("first");
    await send("second");
    const key = { profileId: id, identity: "alice", scheme: "bearerAuth", kind: "active" as const };
    expect(getSecurityCredentialRepository().read(sessionId, key)).toBe("second");
    expect((await send("")).status).toBe(204);
    expect(getSecurityCredentialRepository().isSet(sessionId, key)).toBe(false);
  });

  it("refuses an identity or scheme the profile does not declare, so the store holds nothing unusable", async () => {
    const { agent, sessionId } = await session();
    const created = await createProfile(agent);
    const id = created.profile.id;
    const unknownIdentity = await agent.put(`${BASE}/profiles/${id}/credentials`).send({ identity: "carol", scheme: "bearerAuth", kind: "active", value: "v" });
    expect(unknownIdentity.status).toBe(422);
    expect(unknownIdentity.body.violations[0].code).toBe("credential_identity_unknown");
    const undeclaredScheme = await agent.put(`${BASE}/profiles/${id}/credentials`).send({ identity: "alice", scheme: "apiKeyAuth", kind: "active", value: "v" });
    expect(undeclaredScheme.body.violations[0].code).toBe("credential_scheme_not_declared");
    // Alice declares an expired credential for bearerAuth but Bob declares none.
    const noExpired = await agent.put(`${BASE}/profiles/${id}/credentials`).send({ identity: "bob", scheme: "bearerAuth", kind: "expired", value: "v" });
    expect(noExpired.status).toBe(422);
    expect(getSecurityCredentialRepository().listStatus(sessionId, id)).toEqual([]);
  });

  it.each([
    [{ scheme: "bearerAuth", kind: "active", value: "v" }],
    [{ identity: "alice", kind: "active", value: "v" }],
    [{ identity: "alice", scheme: "bearerAuth", kind: "forever", value: "v" }],
    [{ identity: "alice", scheme: "bearerAuth", kind: "active" }],
    [{ identity: "alice", scheme: "bearerAuth", kind: "active", value: 42 }],
    [{ identity: "alice", scheme: "bearerAuth", kind: "active", value: "v".repeat(8193) }],
    [{ identity: "alice", scheme: "bearerAuth", kind: "active", value: "v", extra: 1 }],
  ])("refuses the malformed credential body %j with 400", async (body) => {
    const { agent } = await session();
    const created = await createProfile(agent);
    const res = await agent.put(`${BASE}/profiles/${created.profile.id}/credentials`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("removes a credential when an edit stops declaring it, and keeps the ones it still declares", async () => {
    const { agent, sessionId } = await session();
    const env = await environment(agent);
    const created = await createProfile(agent, {}, env);
    const id = created.profile.id;
    for (const [identity, scheme] of [["alice", "bearerAuth"], ["bob", "bearerAuth"], ["bob", "apiKeyAuth"]]) {
      await agent.put(`${BASE}/profiles/${id}/credentials`).send({ identity, scheme, kind: "active", value: `v-${identity}-${scheme}` });
    }
    await agent.put(`${BASE}/profiles/${id}`).send(
      profileBody(env.id, { identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] }, { name: "bob", role: "other-user", credentialSchemes: ["bearerAuth"] }] }),
    );
    expect(getSecurityCredentialRepository().listStatus(sessionId, id).map((entry) => `${entry.identity}/${entry.scheme}`)).toEqual(["alice/bearerAuth", "bob/bearerAuth"]);
  });

  it("answers 404 for credentials of an unknown profile", async () => {
    const { agent } = await session();
    expect((await agent.get(`${BASE}/profiles/nope/credentials`)).status).toBe(404);
    expect((await agent.put(`${BASE}/profiles/nope/credentials`).send({ identity: "a", scheme: "b", kind: "active", value: "v" })).status).toBe(404);
  });
});

describe("POST /profiles/:id/check resolves without connecting", () => {
  it("reports the addresses a name resolves to, the one a request would use, and its class", async () => {
    const seen: string[] = [];
    const app = appWith(async (hostname) => {
      seen.push(hostname);
      return ["10.0.0.5", PUBLIC_ADDRESS];
    });
    const { agent } = await session(app);
    const created = await createProfile(agent);
    const res = await agent.post(`${BASE}/profiles/${created.profile.id}/check`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(seen).toEqual(["api.example.test"]);
    expect(res.body.destination).toMatchObject({ host: "api.example.test", port: 443, resolvedClass: "public", connectTo: PUBLIC_ADDRESS });
    expect(res.body.destination.addresses).toEqual([
      expect.objectContaining({ address: "10.0.0.5", addressClass: "private", allowed: false, reason: "restricted_address_blocked" }),
      expect.objectContaining({ address: PUBLIC_ADDRESS, addressClass: "public", allowed: true }),
    ]);
  });

  it("reports a name that resolves only to blocked addresses as invalid, with the reason", async () => {
    const { agent } = await session(appWith(async () => ["169.254.169.254"]));
    const created = await createProfile(agent);
    const res = await agent.post(`${BASE}/profiles/${created.profile.id}/check`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.destination).toMatchObject({ blockedReason: "metadata_address_blocked", resolvedClass: "link-local" });
    expect(res.body.destination.connectTo).toBeUndefined();
    expect(res.body.problems.map((p: { code: string }) => p.code)).toEqual(["destination_blocked"]);
  });

  it("lets a local profile reach a loopback address only when it names it, and sees localhost resolving to both loopbacks", async () => {
    const resolver: Resolver = async () => ["::1", "127.0.0.1"];
    const local = async (ranges: string[]) => {
      const { agent } = await session(appWith(resolver));
      const env = await environment(agent, { name: "Local", tier: "local", baseUrl: "http://localhost:3000" });
      const created = await agent.post(`${BASE}/profiles`).send(profileBody(env.id, { name: "Local", allowedHosts: ["localhost"], allowedPorts: [3000], allowedAddressRanges: ranges }));
      expect(created.status).toBe(201);
      return (await agent.post(`${BASE}/profiles/${created.body.profile.id}/check`)).body;
    };
    expect((await local(["127.0.0.1"])).destination).toMatchObject({ connectTo: "127.0.0.1", resolvedClass: "loopback" });
    expect((await local(["::1"])).destination).toMatchObject({ connectTo: "::1" });
    const none = await local([]);
    expect(none.valid).toBe(false);
    expect(none.destination.blockedReason).toBe("restricted_address_blocked");
  });

  it("resolves a host only after the profile's own host list allows it, so the route cannot resolve an arbitrary name", async () => {
    const seen: string[] = [];
    const { agent } = await session(appWith(async (hostname) => { seen.push(hostname); return [PUBLIC_ADDRESS]; }));
    const env = await environment(agent);
    const created = await createProfile(agent, {}, env);
    // The target now points at a host the profile does not allow.
    await agent.put(`${BASE}/environments/${env.id}`).send({ name: "Staging", tier: "staging", baseUrl: "https://elsewhere.example.test" });
    const res = await agent.post(`${BASE}/profiles/${created.profile.id}/check`);
    expect(res.body.valid).toBe(false);
    expect(res.body.destination).toMatchObject({ host: "elsewhere.example.test", blockedReason: "host_not_allowed", addresses: [] });
    expect(seen).toEqual([]);
  });

  it("does not resolve a literal IP, and judges it directly", async () => {
    const seen: string[] = [];
    const { agent } = await session(appWith(async (hostname) => { seen.push(hostname); return []; }));
    const env = await environment(agent, { baseUrl: `https://${PUBLIC_ADDRESS}` });
    const created = await agent.post(`${BASE}/profiles`).send(profileBody(env.id, { allowedHosts: [PUBLIC_ADDRESS] }));
    expect(created.status).toBe(201);
    const res = await agent.post(`${BASE}/profiles/${created.body.profile.id}/check`);
    expect(res.body.valid).toBe(true);
    expect(res.body.destination.connectTo).toBe(PUBLIC_ADDRESS);
    expect(seen).toEqual([]);
  });

  it.each([
    ["fails", async () => { throw new Error("getaddrinfo ENOTFOUND api.example.test"); }],
    ["answers with nothing", async () => []],
  ] as Array<[string, Resolver]>)("reports a name whose resolution %s as a problem, never as valid", async (_name, resolver) => {
    const { agent } = await session(appWith(resolver));
    const created = await createProfile(agent);
    const res = await agent.post(`${BASE}/profiles/${created.profile.id}/check`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.problems.map((p: { code: string }) => p.code)).toEqual(["host_not_resolved"]);
    expect(JSON.stringify(res.body)).not.toContain("getaddrinfo");
  });

  it("re-validates the stored profile, so a production target is reported", async () => {
    const { agent } = await session();
    const env = await environment(agent);
    const created = await createProfile(agent, {}, env);
    await agent.put(`${BASE}/environments/${env.id}`).send({ name: "Staging", tier: "production", baseUrl: "https://api.example.test" });
    const res = await agent.post(`${BASE}/profiles/${created.profile.id}/check`);
    expect(res.body.valid).toBe(false);
    expect(res.body.problems.map((p: { code: string }) => p.code)).toContain("production_tier_refused");
  });

  it("answers 404 for an unknown profile", async () => {
    const { agent } = await session();
    expect((await agent.post(`${BASE}/profiles/nope/check`)).status).toBe(404);
  });
});

describe("profiles are session data (FR-051)", () => {
  it("are removed, with their credentials, after a forced session expiry, while the owner's retained work stays", async () => {
    const { agent, sessionId } = await session();
    const created = await createProfile(agent);
    await agent.put(`${BASE}/profiles/${created.profile.id}/credentials`).send({ identity: "alice", scheme: "bearerAuth", kind: "active", value: SECRET_BEARER_TOKEN });
    await agent.put(`${BASE}/settings`).send({ sensitiveFields: ["internalNote"] });
    expect(getSecurityProfileRepository().list(sessionId)).toHaveLength(1);

    forceExpireForTest(sessionId);

    expect(getSecurityProfileRepository().list(sessionId)).toEqual([]);
    expect(getSecurityCredentialRepository().listStatus(sessionId, created.profile.id)).toEqual([]);
    expect(getSharedConnection().db.prepare("SELECT COUNT(*) AS n FROM security_credentials").get()).toEqual({ n: 0 });
    // Retained work is keyed by the owner cookie, which a session expiry does not touch.
    expect((await agent.get(`${BASE}/settings`)).body.sensitiveFields).toEqual(["internalNote"]);
  });
});
