import { afterEach, describe, expect, it } from "vitest";
import { getSecurityEvidenceRepository } from "../../../src/persistence/securityEvidenceRepository";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import type { OutboundRequest, SendOptions, SendOutcome, Sender } from "../../../src/securityLab/execution/types";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import {
  ALL_EXECUTABLE_CATEGORIES,
  approve,
  confirmationFor,
  generateAll,
  preview,
  profileBody,
  runBody,
  scenarioIds,
  startHarness,
  startRun,
  waitForRun,
  type Harness,
  type ScenarioRef,
} from "../../fixtures/securityLab/runHarness";
import { makeRun } from "../../fixtures/securityLab/builders";
import { ALICE_TOKEN, BOB_TOKEN } from "../../fixtures/securityLab/runFixtures";
import { sampleHandler } from "../../fixtures/securityLab/sampleTargets";
import { ALL_SECRETS, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

const BASE = "/api/security-lab";
const harnesses: Harness[] = [];

afterEach(async () => {
  await settleActiveRuns();
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
});

async function harness(options: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  const created = await startHarness(options);
  harnesses.push(created);
  await generateAll(created);
  return created;
}

const authOnOrders = (h: Harness) => scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`);

/** A sender that answers without a network, for the tests about confirmation and tiers. */
function fakeSender(): Sender & { calls: OutboundRequest[] } {
  const calls: OutboundRequest[] = [];
  return {
    calls,
    async send(request: OutboundRequest, _options: SendOptions): Promise<SendOutcome> {
      calls.push(request);
      return { status: 401, headers: {}, bodyText: "{}", truncated: false, durationMs: 1, destination: { host: "api.example.test", port: 443, addressClass: "public", verdict: "allowed" }, redirects: [], requestsSent: 1 };
    },
  };
}

const stagingProfile = { allowedHosts: ["api.example.test"], allowedPorts: [443], allowedAddressRanges: [] };

describe("POST /runs/preview", () => {
  it("judges the plan and sends nothing to the target", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const res = await preview(h, items);
    expect(res.status).toBe(200);
    expect(res.body.problems).toEqual([]);
    expect(res.body.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.summary).toMatchObject({
      profileName: "Sample profile",
      environmentName: "Sample target",
      tier: "local",
      baseUrl: h.target.origin,
      scenarioCount: items.length,
      statement: "Real requests will be sent to this target.",
      destinations: [{ host: "127.0.0.1", port: h.target.portNumber }],
    });
    expect(res.body.scenarios).toHaveLength(items.length);
    expect(h.target.requests).toEqual([]);
  });

  it("reports an unapproved scenario as a problem with its code, still answering 200", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    const res = await preview(h, items);
    expect(res.status).toBe(200);
    expect(res.body.problems.map((problem: { code: string }) => problem.code)).toEqual(items.map(() => "not_approved"));
    expect(res.body.problems[0]).toMatchObject({ scenarioId: items[0].id, version: 1 });
    expect(h.target.requests).toEqual([]);
  });

  it("refuses a run limit above the profile's, naming it", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const res = await preview(h, items, { limits: { maxRequests: 9_999 } });
    expect(res.body.problems.map((problem: { code: string }) => problem.code)).toEqual(["limit_above_profile"]);
  });

  it("answers 404 for an unknown profile, 400 for a malformed body and 422 run_plan_invalid for a profile that is no longer valid", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    expect((await h.agent.post(`${BASE}/runs/preview`).send({ profileId: "nope", items })).status).toBe(404);
    for (const body of [{ items }, { profileId: h.profileId }, { profileId: h.profileId, items: "all" }, { profileId: h.profileId, items: [{ id: "x" }] }, "text"]) {
      const res = await h.agent.post(`${BASE}/runs/preview`).send(body as object);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    }
    await h.agent.put(`${BASE}/environments/${h.environmentId}`).send({ name: "Sample target", tier: "production", baseUrl: h.target.origin });
    const production = await preview(h, items);
    expect(production.status).toBe(422);
    expect(production.body.error).toBe("run_plan_invalid");
    expect(production.body.problems[0].code).toBe("profile_invalid");
    expect(h.target.requests).toEqual([]);
  });
});

describe("POST /runs: the executed plan is the confirmed plan", () => {
  it("refuses a digest that is not the current plan's, and sends nothing", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const previewed = await preview(h, items);
    const res = await h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), planDigest: "0".repeat(64), confirmation: confirmationFor(h, previewed.body) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_changed");
    expect(h.target.requests).toEqual([]);
  });

  it("refuses when the profile changed between preview and start", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const previewed = await preview(h, items);
    const edited = await h.agent.put(`${BASE}/profiles/${h.profileId}`).send(profileBody(h, { maxRequests: 150 }));
    expect(edited.status).toBe(200);
    const res = await h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), planDigest: previewed.body.planDigest, confirmation: confirmationFor(h, previewed.body) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_changed");
    expect(h.target.requests).toEqual([]);
  });

  it("refuses when a scenario changed between preview and start", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const previewed = await preview(h, items);
    const edit = await h.agent.patch(`${BASE}/scenarios/${items[0].id}`).send({ expectedVersion: 1, changes: { title: "A new title" } });
    expect(edit.status).toBe(200);
    const res = await h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), planDigest: previewed.body.planDigest, confirmation: confirmationFor(h, previewed.body) });
    // A non-material edit keeps approval, but it is a new version, so the version that was previewed is stale.
    expect(res.status).toBe(422);
    expect(res.body.problems.map((problem: { code: string }) => problem.code)).toEqual(["stale_version"]);
    expect(h.target.requests).toEqual([]);
  });

  it("requires the authorization attestation, even on a local target", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const previewed = await preview(h, items);
    const res = await h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), planDigest: previewed.body.planDigest, confirmation: confirmationFor(h, previewed.body, { authorizationAttested: false }) });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "confirmation_required", missing: ["authorizationAttested"] });
    expect(h.target.requests).toEqual([]);
  });

  it("requires a staging-like run to retype the exact target name and base URL, and says which is missing", async () => {
    const sender = fakeSender();
    const h = await harness({ tier: "staging", baseUrl: "https://api.example.test", profile: stagingProfile, securityLab: { sender, resolveName: async () => ["93.184.216.34"] } });
    const items = await authOnOrders(h);
    await approve(h, items);
    const previewed = await preview(h, items);
    expect(previewed.body.problems).toEqual([]);
    const start = (confirmation: Record<string, unknown>) => h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), planDigest: previewed.body.planDigest, confirmation });

    const nothing = await start(confirmationFor(h, previewed.body, { targetName: "", targetBaseUrl: "" }));
    expect(nothing.body).toMatchObject({ error: "confirmation_required", missing: ["targetName", "targetBaseUrl"] });
    const wrongName = await start(confirmationFor(h, previewed.body, { targetName: "sample target" }));
    expect(wrongName.body.missing).toEqual(["targetName"]);
    const wrongUrl = await start(confirmationFor(h, previewed.body, { targetBaseUrl: "https://api.example.test/" }));
    expect(wrongUrl.body.missing).toEqual(["targetBaseUrl"]);
    expect(sender.calls).toEqual([]);

    const good = await start(confirmationFor(h, previewed.body));
    expect(good.status).toBe(202);
    await waitForRun(h, good.body.run.id);
    expect(sender.calls.length).toBeGreaterThan(0);
  });

  it("needs each destructive scenario confirmed by name, and refuses an id that is not in the plan", async () => {
    const h = await harness({ profile: { destructivePermitted: true } });
    const items = await scenarioIds(h, `operation=${encodeURIComponent("DELETE /orders/{orderId}")}&category=broken-object-level-authorization`);
    expect(items.length).toBeGreaterThan(0);
    await approve(h, items);
    const previewed = await preview(h, items);
    expect(previewed.body.problems).toEqual([]);
    expect(previewed.body.summary.destructive.map((entry: { scenarioId: string }) => entry.scenarioId)).toEqual(items.map((item) => item.id));
    const start = (ids: string[]) => h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), planDigest: previewed.body.planDigest, confirmation: confirmationFor(h, previewed.body, { destructiveScenarioIds: ids }) });
    const none = await start([]);
    expect(none.body.missing).toEqual(items.map((item) => `destructiveScenarioIds:${item.id}`));
    const extra = await start([...items.map((item) => item.id), "ss-not-in-the-plan"]);
    expect(extra.body.missing).toEqual(["destructiveScenarioIds:ss-not-in-the-plan is not in the plan"]);
    expect(h.target.requests).toEqual([]);
  });

  it("refuses to start a plan with problems, with every problem listed, and sends nothing", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    const previewed = await preview(h, items);
    const res = await h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), planDigest: previewed.body.planDigest, confirmation: confirmationFor(h, previewed.body) });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("run_plan_invalid");
    expect(res.body.problems.map((problem: { code: string }) => problem.code)).toEqual(items.map(() => "not_approved"));
    expect(h.target.requests).toEqual([]);
  });

  it.each([
    [{ planDigest: "short" }],
    [{ planDigest: "a".repeat(64), confirmation: "yes" }],
    [{ planDigest: "a".repeat(64), confirmation: { destructiveScenarioIds: "all" } }],
  ])("refuses the malformed start body %j with 400", async (extra) => {
    const h = await harness();
    const items = await authOnOrders(h);
    const res = await h.agent.post(`${BASE}/runs`).send({ ...runBody(h, items), ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

describe("a confirmed run", () => {
  it("sends only the approved scenarios to the allowed target, as the right identity, and records every outcome", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const started = await startRun(h, items);
    expect(started.status).toBe(202);
    expect(started.body.run).toMatchObject({ status: "in-progress", cancelRequested: false });
    expect(started.body.run).not.toHaveProperty("ownerId");
    expect(started.body.run).not.toHaveProperty("sessionId");

    const detail = await waitForRun(h, started.body.run.id);
    expect(detail.run.status).toBe("completed");
    expect(detail.results).toHaveLength(items.length);
    expect(detail.progress).toMatchObject({ planned: items.length, finished: items.length, inFlight: 0 });
    expect(Object.values(detail.run.summary as Record<string, number>).reduce((sum, count) => sum + count, 0)).toBe(items.length);
    expect(detail.run.budget.used).toBe(h.target.requests.length);
    expect(h.target.requests.length).toBeGreaterThan(0);
    expect(h.target.requests.every((entry) => entry.url === "/orders" && entry.method === "GET")).toBe(true);
    // The omit, invalid and malformed variants send no valid credential; the expired one sends the known-expired one.
    expect(h.target.requests.some((entry) => entry.headers.authorization === undefined)).toBe(true);
    expect(h.target.requests.some((entry) => entry.headers.authorization === "Bearer sl-invalid-credential")).toBe(true);
    expect(h.target.requests.some((entry) => entry.headers.authorization === "Bearer sl-fixture-alice-expired-token")).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(ALICE_TOKEN);

    const scenarios = await h.agent.get(`${BASE}/scenarios?executionStatus=evaluated&pageSize=100`);
    expect(scenarios.body.total).toBe(items.length);
  });

  it("uses the identity a scenario names: a cross-identity read is sent as the other identity to the owner's resource", async () => {
    const h = await harness();
    const items = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders/{orderId}")}&category=broken-object-level-authorization`);
    await approve(h, items);
    const started = await startRun(h, items);
    const detail = await waitForRun(h, started.body.run.id);
    expect(h.target.requests.map((entry) => [entry.url, entry.headers.authorization])).toEqual([["/orders/ord-1001", `Bearer ${BOB_TOKEN}`]]);
    expect(detail.results[0]).toMatchObject({ evidenceCount: 1, evidenceAvailable: true });
  });

  it("serves redacted evidence for a result while the session lives, and reports it unavailable after it expires, keeping the summary", async () => {
    const h = await harness();
    const items = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders/{orderId}")}&category=broken-object-level-authorization`);
    await approve(h, items);
    const started = await startRun(h, items);
    const detail = await waitForRun(h, started.body.run.id);

    const evidence = await h.agent.get(`${BASE}/runs/${started.body.run.id}?evidence=true&scenarioId=${items[0].id}`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.evidence.available).toBe(true);
    expect(evidence.body.evidence.records).toHaveLength(1);
    expect(evidence.body.evidence.records[0]).toMatchObject({ method: "GET", responseStatus: 403, destination: { verdict: "allowed", addressClass: "loopback" } });
    assertNoSecrets("evidence route", evidence.text, [ALICE_TOKEN, BOB_TOKEN, ...ALL_SECRETS]);
    expect((await h.agent.get(`${BASE}/runs/${started.body.run.id}?evidence=true&scenarioId=ss-other`)).status).toBe(400);

    forceExpireForTest(h.sessionId);
    expect(getSecurityEvidenceRepository().has(h.sessionId, detail.results[0].id)).toBe(false);
    const after = await h.agent.get(`${BASE}/runs/${started.body.run.id}?evidence=true&scenarioId=${items[0].id}`);
    expect(after.status).toBe(200);
    expect(after.body.evidence).toEqual({ available: false, records: [] });
    expect(after.body.results[0]).toMatchObject({ outcome: detail.results[0].outcome, evidenceAvailable: false });
    expect(after.body.run.profileSummary).toMatchObject({ profileName: "Sample profile", baseUrl: h.target.origin });
    expect(JSON.stringify(after.body.run.profileSummary)).not.toMatch(/alice|bob|ord-1001|allowedHosts/);
  });

  it("refuses a new run after the session expired, because the profile went with it", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    forceExpireForTest(h.sessionId);
    const res = await preview(h, items);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("profile_not_found");
    expect(h.target.requests).toEqual([]);
  });

  it("lists runs newest first as views without identifiers of the browser", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const first = await startRun(h, items);
    await waitForRun(h, first.body.run.id);
    const second = await startRun(h, items);
    await waitForRun(h, second.body.run.id);
    const list = await h.agent.get(`${BASE}/runs`);
    expect(list.status).toBe(200);
    expect(list.body.runs.map((run: { id: string }) => run.id)).toEqual([second.body.run.id, first.body.run.id]);
    expect(list.text).not.toContain(h.sessionId);
    expect(list.text).not.toContain(h.ownerId);
  });

  it("keeps each browser's runs apart", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const started = await startRun(h, items);
    await waitForRun(h, started.body.run.id);
    const other = await import("supertest").then((module) => module.default.agent(h.app));
    expect((await other.get(`${BASE}/runs`)).body.runs).toEqual([]);
    expect((await other.get(`${BASE}/runs/${started.body.run.id}`)).status).toBe(404);
    expect((await other.post(`${BASE}/runs/${started.body.run.id}/cancel`)).status).toBe(404);
  });

  it("answers 404 for an unknown run", async () => {
    const h = await harness();
    expect((await h.agent.get(`${BASE}/runs/nope`)).status).toBe(404);
    expect((await h.agent.get(`${BASE}/runs/nope`)).body.error).toBe("run_not_found");
  });
});

describe("one execution at a time, and cancellation", () => {
  const slow = (h: Harness, ms: number) => {
    const inner = sampleHandler();
    h.target.setHandler((req, res) => {
      setTimeout(() => inner(req, res), ms);
    });
  };

  it("refuses a second start while a run is in progress, and cancel stops the first with partial results", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    slow(h, 250);
    const started = await startRun(h, items, { limits: { maxConcurrency: 1 } });
    expect(started.status).toBe(202);

    const second = await startRun(h, items);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: "execution_in_progress", runId: started.body.run.id });

    const cancelled = await h.agent.post(`${BASE}/runs/${started.body.run.id}/cancel`);
    expect(cancelled.status).toBe(202);
    expect(cancelled.body.run).toMatchObject({ cancelRequested: true, cancelReason: "user-requested" });

    const detail = await waitForRun(h, started.body.run.id);
    expect(detail.run.status).toBe("cancelled");
    expect(detail.results).toHaveLength(items.length);
    expect(detail.results.filter((result: { outcome: string }) => result.outcome === "not_run").length).toBeGreaterThan(0);
    expect((await h.agent.post(`${BASE}/runs/${started.body.run.id}/cancel`)).status).toBe(409);
    expect((await h.agent.post(`${BASE}/runs/${started.body.run.id}/cancel`)).body.error).toBe("no_run_in_progress");

    // The slot is free again.
    slow(h, 0);
    const third = await startRun(h, items);
    expect(third.status).toBe(202);
    await waitForRun(h, third.body.run.id);
  });

  it("settles a run left in progress by a previous process as cancelled by a restart, which frees the slot", async () => {
    const h = await harness();
    const items = await authOnOrders(h);
    await approve(h, items);
    const orphan = makeRun({ id: "run-from-before-restart", ownerId: h.ownerId, sessionId: h.sessionId, status: "in-progress" });
    getSecurityRunRepository().createRun(orphan);
    expect((await startRun(h, items)).status).toBe(409);

    expect(getSecurityRunRepository().markInterruptedRunsCancelled("2026-02-02T00:00:00.000Z")).toBe(1);
    const settled = await h.agent.get(`${BASE}/runs/run-from-before-restart`);
    expect(settled.body.run).toMatchObject({ status: "cancelled", cancelReason: "backend-restart", completedAt: "2026-02-02T00:00:00.000Z" });
    const next = await startRun(h, items);
    expect(next.status).toBe(202);
    await waitForRun(h, next.body.run.id);
  });
});

describe("categories the profile does not permit", () => {
  it("refuses a scenario of a category the profile leaves out", async () => {
    const h = await harness({ profile: { permittedCategories: ALL_EXECUTABLE_CATEGORIES.filter((category) => category !== "authentication") } });
    const items: ScenarioRef[] = await authOnOrders(h);
    await approve(h, items);
    const res = await preview(h, items);
    expect(res.body.problems.map((problem: { code: string }) => problem.code)).toEqual(items.map(() => "category_not_permitted"));
    expect(h.target.requests).toEqual([]);
  });
});
