import { afterEach, describe, expect, it } from "vitest";
import { getSecurityEvidenceRepository } from "../../../src/persistence/securityEvidenceRepository";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { isSecurityLabError, type SecurityLabError } from "../../../src/securityLab/errors";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import { runWithOwner } from "../../../src/securityLab/owner/ownerContext";
import { createSecurityLabService } from "../../../src/securityLab/securityLabService";
import { runWithSession } from "../../../src/session/sessionContext";
import { RawTarget } from "../../fixtures/securityLab/rawTarget";
import { approve, confirmationFor, generateAll, scenarioIds, startHarness, type Harness } from "../../fixtures/securityLab/runHarness";

/**
 * specs/057 FR-036, SC-006, tasks T092: every safety rule holds when the service is called directly, with no router,
 * no browser and no interface in the way. Each case calls `createSecurityLabService()` inside the request contexts
 * the router would have set, and asserts a typed refusal (or a recorded block) and that no request reached a target.
 */

const BASE = "/api/security-lab";
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await settleActiveRuns();
  await Promise.all(cleanup.splice(0).map((stop) => stop()));
});

async function setup(options: Parameters<typeof startHarness>[0] = {}): Promise<{ h: Harness; call: <T>(fn: (service: ReturnType<typeof createSecurityLabService>) => T) => T; items: Awaited<ReturnType<typeof scenarioIds>> }> {
  const h = await startHarness(options);
  cleanup.push(() => h.stop());
  await generateAll(h);
  const items = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`);
  const service = createSecurityLabService();
  const call = <T>(fn: (s: typeof service) => T): T => runWithSession(h.sessionId, () => runWithOwner(h.ownerId, () => fn(service)));
  return { h, call, items };
}

function refusal(action: () => unknown): SecurityLabError {
  try {
    action();
  } catch (error) {
    if (isSecurityLabError(error)) return error;
    throw error;
  }
  throw new Error("Expected the service to refuse, but it did not");
}

const input = (h: Harness, items: unknown[], extra: Record<string, unknown> = {}) => ({ profileId: h.profileId, items, ...extra });

describe("the service refuses each violation on its own", () => {
  it("refuses an unknown profile, an unapproved scenario and a missing or wrong confirmation, sending nothing", async () => {
    const { h, call, items } = await setup();

    expect(refusal(() => call((s) => s.previewRun({ profileId: "nope", items }))).code).toBe("profile_not_found");

    const preview = call((s) => s.previewRun(input(h, items)));
    expect(preview.problems.map((p) => p.code)).toEqual(items.map(() => "not_approved"));
    const unapproved = refusal(() => call((s) => s.startRun({ ...input(h, items), planDigest: preview.planDigest, confirmation: confirmationFor(h, preview) })));
    expect(unapproved.code).toBe("run_plan_invalid");

    await approve(h, items);
    const ready = call((s) => s.previewRun(input(h, items)));
    expect(ready.problems).toEqual([]);

    expect(refusal(() => call((s) => s.startRun({ ...input(h, items), confirmation: confirmationFor(h, ready) }))).code).toBe("invalid_request");
    expect(refusal(() => call((s) => s.startRun({ ...input(h, items), planDigest: "1".repeat(64), confirmation: confirmationFor(h, ready) }))).code).toBe("plan_changed");
    const attest = refusal(() => call((s) => s.startRun({ ...input(h, items), planDigest: ready.planDigest, confirmation: confirmationFor(h, ready, { authorizationAttested: false }) })));
    expect(attest).toMatchObject({ code: "confirmation_required", details: { missing: ["authorizationAttested"] } });

    expect(h.target.requests).toEqual([]);
    expect(getSecurityRunRepository().listRuns(h.ownerId)).toEqual([]);
  });

  it("refuses a production target and a category the profile leaves out", async () => {
    const { h, call, items } = await setup();
    await approve(h, items);
    await h.agent.put(`${BASE}/environments/${h.environmentId}`).send({ name: "Sample target", tier: "production", baseUrl: h.target.origin });
    expect(refusal(() => call((s) => s.previewRun(input(h, items)))).code).toBe("run_plan_invalid");
    expect(refusal(() => call((s) => s.startRun({ ...input(h, items), planDigest: "1".repeat(64), confirmation: confirmationFor(h, { summary: { destructive: [] } }) }))).code).toBe("run_plan_invalid");
    expect(h.target.requests).toEqual([]);
  });

  it("refuses a plan above the request limit, and a limit raised above the profile's", async () => {
    const { h, call, items } = await setup({ profile: { maxRequests: 1 } });
    await approve(h, items);
    const over = call((s) => s.previewRun(input(h, items)));
    expect(over.problems[0]).toMatchObject({ code: "budget_exceeded", required: items.length, allowed: 1 });
    const raised = call((s) => s.previewRun(input(h, items.slice(0, 1), { limits: { maxRequests: 2 } })));
    expect(raised.problems.map((p) => p.code)).toEqual(["limit_above_profile"]);
    expect(h.target.requests).toEqual([]);
  });
});

describe("a destination the policy forbids is never reached, even when the target asks for it", () => {
  async function redirectingRun(location: (evil: RawTarget) => string) {
    const evil = new RawTarget((_request, response) => response.writeHead(200).end("reached the wrong place"));
    await evil.start();
    cleanup.push(() => evil.stop());
    const { h, call, items } = await setup();
    h.target.setHandler((_request, response) => response.writeHead(302, { location: location(evil) }).end());
    await approve(h, items);
    const preview = call((s) => s.previewRun(input(h, items)));
    expect(preview.problems).toEqual([]);
    const started = call((s) => s.startRun({ ...input(h, items), planDigest: preview.planDigest, confirmation: confirmationFor(h, preview) }));
    await settleActiveRuns();
    const detail = call((s) => s.getRun(started.run.id, {}));
    return { h, evil, detail, items, call };
  }

  it("blocks a redirect to a port the profile does not allow, and records it as evidence", async () => {
    const { h, evil, detail, items } = await redirectingRun((evil) => `http://127.0.0.1:${evil.portNumber}/stolen`);
    expect(detail.run.status).toBe("completed");
    expect(detail.results.map((r) => r.outcome)).toEqual(items.map(() => "blocked"));
    expect(detail.results[0].reason).toMatch(/allowed ports/);
    expect(evil.requests).toEqual([]);
    expect(h.target.requests).toHaveLength(items.length);
    const [record] = getSecurityEvidenceRepository().list(h.sessionId, detail.results[0].id);
    expect(record.redirects).toEqual([{ toRedacted: expect.stringContaining("/stolen"), verdict: "blocked", reason: "port_not_allowed" }]);
  });

  it.each([
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["a host the profile does not list", "http://evil.example.test/steal"],
    ["a private address", "http://10.0.0.7/internal"],
  ])("blocks a redirect to %s", async (_name, target) => {
    const { detail, items, h } = await redirectingRun(() => target);
    expect(detail.results.map((r) => r.outcome)).toEqual(items.map(() => "blocked"));
    expect(h.target.requests).toHaveLength(items.length);
  });

  it("blocks every request when the target's name resolves somewhere the profile does not allow", async () => {
    const h = await startHarness({
      baseUrl: "http://api.example.test",
      tier: "local",
      profile: { allowedHosts: ["api.example.test"], allowedPorts: [80], allowedAddressRanges: ["127.0.0.1"] },
      securityLab: { resolveName: async () => ["10.0.0.5"] },
    });
    cleanup.push(() => h.stop());
    await generateAll(h);
    const items = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`);
    await approve(h, items);
    const service = createSecurityLabService({ resolveName: async () => ["10.0.0.5"] });
    const call = <T>(fn: (s: typeof service) => T): T => runWithSession(h.sessionId, () => runWithOwner(h.ownerId, () => fn(service)));
    const preview = call((s) => s.previewRun(input(h, items)));
    const started = call((s) => s.startRun({ ...input(h, items), planDigest: preview.planDigest, confirmation: confirmationFor(h, preview) }));
    await settleActiveRuns();
    const detail = call((s) => s.getRun(started.run.id, {}));
    expect(detail.results.map((r) => r.outcome)).toEqual(items.map(() => "blocked"));
    expect(detail.results[0].reason).toMatch(/non-public/);
    const [record] = getSecurityEvidenceRepository().list(h.sessionId, detail.results[0].id);
    expect(record.destination).toMatchObject({ host: "api.example.test", addressClass: "private", verdict: "blocked", reason: "restricted_address_blocked" });
    expect(h.target.requests).toEqual([]);
  });
});
