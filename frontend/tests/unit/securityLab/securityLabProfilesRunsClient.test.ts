import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelRun,
  checkProfile,
  createEnvironment,
  createProfile,
  deleteProfile,
  fetchCredentialStatus,
  fetchRun,
  listEnvironments,
  listProfiles,
  listRuns,
  previewRun,
  setCredential,
  startRun,
  updateEnvironment,
  updateProfile,
} from "../../../src/services/securityLabClient";
import { profileView, runDetail, runPreview, runView, securityProfile, targetEnvironment } from "./securityFixtures";

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), ...response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
};

const { id, createdAt, updatedAt, ...PROFILE_INPUT } = securityProfile();
void id;
void createdAt;
void updatedAt;

afterEach(() => vi.unstubAllGlobals());

describe("environment client (T087)", () => {
  it("lists targets and creates and updates one with name, tier and base URL only", async () => {
    const env = targetEnvironment();
    const list = stubFetch({ json: async () => ({ environments: [env] }) });
    expect(await listEnvironments()).toEqual({ ok: true, data: { environments: [env] } });
    expect(sent(list)).toMatchObject({ url: "/api/security-lab/environments", method: "GET" });

    const create = stubFetch({ json: async () => ({ environment: env }) });
    await createEnvironment({ name: "Staging", tier: "staging", baseUrl: "https://api.example.test" });
    expect(sent(create)).toEqual({ url: "/api/security-lab/environments", method: "POST", body: { name: "Staging", tier: "staging", baseUrl: "https://api.example.test" } });

    const update = stubFetch({ json: async () => ({ environment: env }) });
    await updateEnvironment("env 1", { name: "Staging", tier: "qa", baseUrl: "https://qa.example.test" });
    expect(sent(update)).toMatchObject({ url: "/api/security-lab/environments/env%201", method: "PUT" });
  });

  it("rejects a reply that is not a target", async () => {
    stubFetch({ json: async () => ({ environments: [{ id: 1 }] }) });
    expect(await listEnvironments()).toMatchObject({ ok: false, error: "invalid_response" });
  });
});

describe("profile client (T087)", () => {
  it("lists, creates, updates and checks profiles on the profile routes", async () => {
    const view = profileView();
    const list = stubFetch({ json: async () => ({ profiles: [view] }) });
    expect((await listProfiles()).ok).toBe(true);
    expect(sent(list)).toMatchObject({ url: "/api/security-lab/profiles", method: "GET" });

    const create = stubFetch({ status: 201, json: async () => view });
    expect((await createProfile(PROFILE_INPUT)).ok).toBe(true);
    expect(sent(create)).toMatchObject({ url: "/api/security-lab/profiles", method: "POST", body: PROFILE_INPUT });

    const update = stubFetch({ json: async () => view });
    await updateProfile("p/1", PROFILE_INPUT);
    expect(sent(update)).toMatchObject({ url: "/api/security-lab/profiles/p%2F1", method: "PUT" });

    const check = stubFetch({ json: async () => ({ valid: true, problems: [] }) });
    expect(await checkProfile("p-1")).toEqual({ ok: true, data: { valid: true, problems: [] } });
    expect(sent(check)).toMatchObject({ url: "/api/security-lab/profiles/p-1/check", method: "POST" });
  });

  it("treats the 204 of a delete as success", async () => {
    const del = stubFetch({ status: 204, json: async () => { throw new Error("no body"); } });
    expect(await deleteProfile("p-1")).toEqual({ ok: true, data: {} });
    expect(sent(del)).toMatchObject({ url: "/api/security-lab/profiles/p-1", method: "DELETE" });
  });

  it("carries profile_invalid violations in the failure details", async () => {
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ error: "profile_invalid", message: "The profile is not valid.", violations: [{ field: "tlsPolicy", code: "relaxed_tls_local_only", message: "m" }] }),
    });
    expect(await createProfile(PROFILE_INPUT)).toMatchObject({ ok: false, error: "profile_invalid", status: 422, details: { violations: [{ field: "tlsPolicy" }] } });
  });

  it("sends a credential once on the credentials route, and reads back only its status", async () => {
    const put = stubFetch({ status: 204, json: async () => { throw new Error("no body"); } });
    const result = await setCredential("p-1", { identity: "alice", scheme: "bearerAuth", kind: "active", value: "a-secret-value" });
    expect(result).toEqual({ ok: true, data: {} });
    expect(sent(put)).toEqual({ url: "/api/security-lab/profiles/p-1/credentials", method: "PUT", body: { identity: "alice", scheme: "bearerAuth", kind: "active", value: "a-secret-value" } });

    const get = stubFetch({ json: async () => ({ credentialStatus: [{ identity: "alice", scheme: "bearerAuth", kind: "active", set: true }] }) });
    expect(await fetchCredentialStatus("p-1")).toEqual({ ok: true, data: { credentialStatus: [{ identity: "alice", scheme: "bearerAuth", kind: "active", set: true }] } });
    expect(sent(get)).toMatchObject({ url: "/api/security-lab/profiles/p-1/credentials", method: "GET" });
  });

  it("never writes a credential value to the console, on success or on failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    stubFetch({ ok: false, status: 422, json: async () => ({ error: "profile_invalid", message: "The profile is not valid." }) });
    await setCredential("p-1", { identity: "alice", scheme: "bearerAuth", kind: "active", value: "a-secret-value" });
    stubFetch({ status: 204, json: async () => ({}) });
    await setCredential("p-1", { identity: "alice", scheme: "bearerAuth", kind: "active", value: "a-secret-value" });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("a-secret-value");
      spy.mockRestore();
    }
  });
});

describe("run client (T105)", () => {
  it("previews a plan with explicit items and no digest", async () => {
    const fetchMock = stubFetch({ json: async () => runPreview() });
    const result = await previewRun({ profileId: "p-1", items: [{ id: "ss-1", version: 1 }], limits: { maxRequests: 10 } });
    expect(result.ok).toBe(true);
    expect(sent(fetchMock)).toEqual({ url: "/api/security-lab/runs/preview", method: "POST", body: { profileId: "p-1", items: [{ id: "ss-1", version: 1 }], limits: { maxRequests: 10 } } });
  });

  it("starts a run with the digest and the confirmation", async () => {
    const fetchMock = stubFetch({ status: 202, json: async () => ({ run: runView() }) });
    const body = {
      profileId: "p-1",
      items: [{ id: "ss-1", version: 1 }],
      planDigest: "d".repeat(64),
      confirmation: { targetName: "Staging", targetBaseUrl: "https://api.example.test", authorizationAttested: true, destructiveScenarioIds: [] },
    };
    expect((await startRun(body)).ok).toBe(true);
    expect(sent(fetchMock)).toEqual({ url: "/api/security-lab/runs", method: "POST", body });
  });

  it.each([
    ["plan_changed", 409, {}],
    ["confirmation_required", 409, { missing: ["targetName"] }],
    ["execution_in_progress", 409, { runId: "run-0" }],
    ["run_plan_invalid", 422, { problems: [{ code: "not_approved", message: "m" }] }],
  ])("carries the %s refusal's code, status and details", async (error, status, extra) => {
    stubFetch({ ok: false, status, json: async () => ({ error, message: "Refused.", ...extra }) });
    const result = await startRun({ profileId: "p-1", items: [], planDigest: "d".repeat(64), confirmation: { targetName: "", targetBaseUrl: "", authorizationAttested: false, destructiveScenarioIds: [] } });
    expect(result).toEqual({ ok: false, error, message: "Refused.", status, details: extra });
  });

  it("lists, reads and cancels runs", async () => {
    const list = stubFetch({ json: async () => ({ runs: [runView()] }) });
    expect((await listRuns()).ok).toBe(true);
    expect(sent(list)).toMatchObject({ url: "/api/security-lab/runs", method: "GET" });

    const read = stubFetch({ json: async () => runDetail() });
    expect((await fetchRun("run/1")).ok).toBe(true);
    expect(sent(read)).toMatchObject({ url: "/api/security-lab/runs/run%2F1", method: "GET" });

    const cancel = stubFetch({ status: 202, json: async () => ({ run: runView({ cancelRequested: true }) }) });
    expect((await cancelRun("run-1")).ok).toBe(true);
    expect(sent(cancel)).toMatchObject({ url: "/api/security-lab/runs/run-1/cancel", method: "POST" });
  });

  it("rejects a run reply that is not a run detail", async () => {
    stubFetch({ json: async () => ({ run: { id: "x" } }) });
    expect(await fetchRun("x")).toMatchObject({ ok: false, error: "invalid_response" });
  });
});
