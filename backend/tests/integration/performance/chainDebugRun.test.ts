import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainPlan, DebugRunResult, DebugStepOutcome, MaskedText } from "@apipilot/shared-domain";
import { resetDebugRunsForTests } from "../../../src/performance/chain/debug/debugRunService";
import { resetHeldValuesForTests } from "../../../src/performance/chain/debug/heldValues";
import type { Sender } from "../../../src/performance/chain/debug/sender";
import { getSharedConnection } from "../../../src/persistence/connection";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import type { SandboxRequest, SandboxResponse } from "../../fixtures/performance/k6Sandbox";
import { chainAgent, CHAIN_BASE, createEnvironment, newPlan, savePlanContent } from "../../fixtures/chain/chainAgent";
import { bodyExtractor, chain, chainPlan, customerLifecyclePlan, step } from "../../fixtures/chain/chainPlans";
import { fakeSender } from "../../fixtures/chain/debugRun";

/**
 * AP-039 (specs/039-chain-debug-run tasks T018, T024, T030, T037; contracts/debug-run-api.md):
 * the Debug run routes, with a fake sender, so no network and no k6.
 */

const BASE = "http://127.0.0.1:4600";
const SECRET = "LEAK-SECRET-9a1";
const TOKEN = "LEAK-TOKEN-9a2";
const RESPONSE_MARK = "LEAK-RESPONSE-9a3";
const CELL = "LEAK-CELL-9a4";
const REQUEST_MARK = "LEAK-REQUEST-9a5";
const VALUES = { client_id: "id-1", client_secret: SECRET };

beforeEach(() => {
  resetDebugRunsForTests();
  resetHeldValuesForTests();
});
afterEach(() => vi.restoreAllMocks());

/** The customers stub: a token under `tokenField`, ids by count, and a marker in every body. */
function customers(options: { tokenField?: string; tokenStatus?: number } = {}) {
  let ids = 0;
  return (request: SandboxRequest): SandboxResponse => {
    const path = request.url.slice(BASE.length).split("?")[0];
    if (path === "/auth/token") {
      if (options.tokenStatus) return { status: options.tokenStatus, body: { error: "denied" } };
      return { status: 200, body: { [options.tokenField ?? "access_token"]: TOKEN, note: RESPONSE_MARK } };
    }
    if (path === "/api/v1/customers" && request.method === "POST") {
      ids += 1;
      return { status: 201, body: { id: `cust-${ids}`, note: RESPONSE_MARK } };
    }
    if (request.method === "DELETE") return { status: 204 };
    const id = /\/api\/v1\/customers\/(.+)$/.exec(path)?.[1];
    return { status: 200, body: id ? { id: decodeURIComponent(id), note: RESPONSE_MARK } : { items: [], note: RESPONSE_MARK } };
  };
}

async function ready(options: { respond?: (request: SandboxRequest) => SandboxResponse; sender?: Sender; content?: (environmentId: string) => ChainPlan; lines?: string[]; hold?: boolean } = {}) {
  const fake = fakeSender(options.respond ?? customers());
  const runner = createFakeRunner({ lines: options.lines ?? [], holdUntilCancelled: options.hold });
  const { agent, sessionId } = await chainAgent({ debugSender: options.sender ?? fake.sender, runner, probe: readyProbe() });
  const plan = await newPlan(agent);
  const environmentId = await createEnvironment(agent, VALUES);
  const content = options.content ? options.content(environmentId) : customerLifecyclePlan({ targetEnvironmentId: environmentId });
  const saved = await savePlanContent(agent, plan, content);
  if (saved.status !== 200) throw new Error(`plan not saved: ${saved.status} ${JSON.stringify(saved.body)}`);
  return { agent, sessionId, environmentId, plan: saved.body.plan as ChainPlan, fake };
}

const debugPath = (planId: string) => `${CHAIN_BASE}/${planId}/debug-runs`;

function textOf(text: MaskedText): string {
  return text.map((segment) => (segment.kind === "text" ? segment.text : "[M]")).join("");
}

function allSteps(result: DebugRunResult): DebugStepOutcome[] {
  return [...result.setup, ...result.chains.flatMap((entry) => entry.steps)];
}

function maskedSegments(value: unknown): { valueId: string; revealable: boolean; label: string }[] {
  const found: { valueId: string; revealable: boolean; label: string }[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.kind === "masked") found.push({ valueId: String(record.valueId), revealable: Boolean(record.revealable), label: String(record.label) });
      else Object.values(record).forEach(visit);
    }
  };
  visit(value);
  return found;
}

describe("POST /debug-runs: a run of the plan", () => {
  it("runs every chain once, shows each exchange masked, stores nothing and creates no run", async () => {
    const { agent, plan, environmentId, fake } = await ready();
    const response = await agent.post(debugPath(plan.id)).send({ environmentId });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const result = response.body as DebugRunResult;
    expect(result.outcome).toBe("completed");
    expect(result.environment).toMatchObject({ name: "Local stub", tier: "local", baseUrl: BASE });
    expect(result.setup.map((entry) => [entry.stepId, entry.status])).toEqual([["s1", "sent"]]);
    expect(result.chains[0].steps.map((entry) => entry.status)).toEqual(Array(6).fill("sent"));
    expect(fake.sent.map((input) => `${input.method} ${input.url.slice(BASE.length)}`)).toEqual([
      "POST /auth/token",
      "POST /api/v1/customers",
      "GET /api/v1/customers?page=1&size=20",
      "PUT /api/v1/customers/cust-1",
      "GET /api/v1/customers/cust-1",
      "PATCH /api/v1/customers/cust-1",
      "DELETE /api/v1/customers/cust-1",
    ]);

    const create = result.chains[0].steps[0];
    if (create.status !== "sent") throw new Error("expected a sent step");
    expect(create.request.method).toBe("POST");
    expect(textOf(create.request.url)).toBe(`${BASE}/api/v1/customers`);
    const authorization = create.request.headers.find((header) => header.name === "Authorization");
    expect(authorization?.value).toHaveLength(1);
    expect(authorization?.value[0]).toMatchObject({ kind: "masked", revealable: true });
    expect(create.response?.status).toBe(201);
    expect(create.statusOutcome).toEqual({ expected: ["201"], received: 201, ok: true });
    const body = create.response?.body;
    expect(body?.kind === "text" && textOf(body.text)).toContain(RESPONSE_MARK);
    expect(create.extractors).toMatchObject([{ name: "customer_id", outcome: { kind: "extracted" } }]);
    expect(result.notes.join(" ")).toContain("Think time");

    // No run record, no report, nothing in the runs list (FR-010).
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}/runs`)).body.runs).toEqual([]);
  });

  it("never returns an engineer-supplied secret or a credential in clear", async () => {
    const { agent, plan, environmentId } = await ready();
    const response = await agent.post(debugPath(plan.id)).send({ environmentId });
    expect(response.text).not.toContain(SECRET);
    expect(response.text).not.toContain(TOKEN);
    expect(response.text).toContain(RESPONSE_MARK);
    const segments = maskedSegments(response.body);
    expect(segments.some((segment) => segment.label === "secret value client_secret" && !segment.revealable)).toBe(true);
    expect(segments.some((segment) => segment.revealable)).toBe(true);
  });

  it("explains an extractor that does not match the response and shows later steps as not sent", async () => {
    const { agent, plan, environmentId } = await ready({
      respond: customers({ tokenField: "token" }),
      content: (target) =>
        chainPlan({
          targetEnvironmentId: target,
          secretNames: ["client_secret"],
          chains: [
            chain("c1", "Chain", [
              step({ id: "s1", name: "issueToken", method: "POST", url: "{{baseUrl}}/auth/token", body: { kind: "form", fields: [{ name: "client_secret", value: "{{client_secret}}" }] }, extractors: [bodyExtractor("x1", "token", "access_token")] }),
              step({ id: "s2", name: "listCustomers", url: "{{baseUrl}}/api/v1/customers", headers: [{ name: "Authorization", value: "Bearer {{token}}" }] }),
            ]),
          ],
        }),
    });
    const result = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    expect(result.outcome).toBe("stopped-early");
    const [first, second] = result.chains[0].steps;
    if (first.status !== "sent") throw new Error("expected sent");
    expect(first.statusOutcome.ok).toBe(true);
    expect(first.extractors[0]).toMatchObject({ name: "token", outcome: { kind: "failed", reason: { code: "path-not-found", path: "access_token" } } });
    // The response body shows the real field name, with its value masked.
    expect(first.response?.body.kind === "text" && textOf(first.response.body.text)).toContain('"token":"[M]"');
    expect(second).toMatchObject({ status: "not-sent", cause: { kind: "stopped-by", stepId: "s1", stepName: "issueToken", reason: "extractor-failed" } });
    expect(result.chains[0].stoppedAt).toEqual({ stepId: "s1", cause: "extractor-failed" });
  });

  it("ends the run with a setup failure and marks every other step not sent", async () => {
    const { agent, plan, environmentId } = await ready({ respond: customers({ tokenStatus: 401 }) });
    const result = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    expect(result.outcome).toBe("setup-failed");
    const sent = allSteps(result).filter((entry) => entry.status === "sent");
    expect(sent.map((entry) => entry.stepId)).toEqual(["s1"]);
    const rest = result.chains[0].steps;
    expect(rest.every((entry) => entry.status === "not-sent" && entry.cause.kind === "stopped-by" && entry.cause.reason === "setup-failed")).toBe(true);
  });

  it("shows a step with no response as the attempted request and a reason", async () => {
    const down: Sender = { send: () => Promise.resolve({ kind: "no-response", reason: "refused", durationMs: 3, redirects: [] }) };
    const { agent, plan, environmentId } = await ready({ sender: down });
    const result = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    const first = result.setup[0];
    if (first.status !== "sent") throw new Error("expected sent");
    expect(first.response).toBeNull();
    expect(first.noResponseReason).toBe("refused");
    expect(textOf(first.request.url)).toBe(`${BASE}/auth/token`);
    expect(result.outcome).toBe("setup-failed");
  });

  it("debugs the plan as saved, with no script generated", async () => {
    const { agent, plan, environmentId } = await ready();
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.script).toBeNull();
    expect((await agent.post(debugPath(plan.id)).send({ environmentId })).status).toBe(200);
  });

  it("does not stop at a missing value: the affected step is not sent, with the names", async () => {
    const { agent, plan, environmentId } = await ready({
      content: (target) =>
        chainPlan({
          targetEnvironmentId: target,
          chains: [chain("c1", "Chain", [step({ id: "s1", url: "{{baseUrl}}/a", headers: [{ name: "X-Api-Key", value: "{{api_key}}" }] }), step({ id: "s2", url: "{{baseUrl}}/b" })])],
        }),
    });
    const result = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    expect(result.chains[0].steps[0]).toMatchObject({ status: "not-sent", cause: { kind: "missing-value", names: ["api_key"] } });
    expect(result.chains[0].steps[1].status).toBe("sent");
  });

  it("reports a host outside the allowed hosts as not sent, sends nothing there, and runs the next step", async () => {
    const { agent, plan, environmentId, fake } = await ready({
      content: (target) =>
        chainPlan({
          targetEnvironmentId: target,
          // `{{baseUrl}}@evil...` starts with the base URL, so the plan is valid, but the host it resolves to is another.
          chains: [chain("c1", "Chain", [step({ id: "s1", url: "{{baseUrl}}@evil.example.test/a" }), step({ id: "s2", url: "{{baseUrl}}/b" })])],
        }),
    });
    const result = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    expect(result.chains[0].steps[0]).toMatchObject({ status: "not-sent", cause: { kind: "host-not-allowed", host: "evil.example.test" } });
    expect(result.chains[0].steps[1].status).toBe("sent");
    expect(fake.sent.map((input) => input.url)).toEqual([`${BASE}/b`]);
  });

  it("shows a redirect that was not followed because its host is not allowed", async () => {
    const redirecting: Sender = {
      send: () =>
        Promise.resolve({
          kind: "response",
          status: 302,
          statusText: "Found",
          headers: [["location", "http://evil.example.test/x"]],
          contentType: null,
          body: new Uint8Array(0),
          bodyTruncated: false,
          durationMs: 2,
          redirects: [`${BASE}/hop`],
          redirectBlockedTo: "evil.example.test",
        }),
    };
    const { agent, plan, environmentId } = await ready({
      sender: redirecting,
      content: (target) => chainPlan({ targetEnvironmentId: target, chains: [chain("c1", "Chain", [step({ id: "s1", url: "{{baseUrl}}/a", expectedStatuses: ["302"] })])] }),
    });
    const result = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    const first = result.chains[0].steps[0];
    if (first.status !== "sent") throw new Error("expected sent");
    expect(first.response?.redirectBlockedTo).toBe("evil.example.test");
    expect(first.response?.redirects.map(textOf)).toEqual([`${BASE}/hop`]);
  });
});

describe("POST /debug-runs: refusals", () => {
  it("refuses an invalid environment id, an unknown environment and an unknown plan", async () => {
    const { agent, plan, environmentId } = await ready();
    expect((await agent.post(debugPath(plan.id)).send({})).body).toMatchObject({ error: "invalid_request" });
    expect((await agent.post(debugPath(plan.id)).send({ environmentId: "nope" })).status).toBe(400);
    const missingEnvironment = await agent.post(debugPath(plan.id)).send({ environmentId: "00000000-0000-4000-8000-000000000001" });
    expect([missingEnvironment.status, missingEnvironment.body.error]).toEqual([404, "environment_not_found"]);
    const missingPlan = await agent.post(debugPath("00000000-0000-4000-8000-000000000002")).send({ environmentId });
    expect([missingPlan.status, missingPlan.body.error]).toEqual([404, "chain_plan_not_found"]);
  });

  it("refuses a plan with blockers", async () => {
    const { agent, environmentId } = await ready();
    const empty = await newPlan(agent, "Empty");
    const response = await agent.post(debugPath(empty.id)).send({ environmentId });
    expect([response.status, response.body.error]).toEqual([422, "plan_has_blockers"]);
  });

  it("refuses while another execution run is in progress", async () => {
    const { agent, plan, environmentId } = await ready({ hold: true });
    expect((await agent.post(`${CHAIN_BASE}/${plan.id}/script`)).status).toBe(200);
    const started = await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId });
    expect(started.status).toBe(200);
    const response = await agent.post(debugPath(plan.id)).send({ environmentId });
    expect([response.status, response.body.error]).toEqual([409, "execution_in_progress"]);
    expect((await agent.post(`${CHAIN_BASE}/runs/${started.body.run.id}/cancel`)).status).toBe(202);
  });

  it("refuses a second Debug run of the same plan while one is running, and frees the plan afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Sender = {
      async send() {
        await gate;
        return { kind: "response", status: 200, statusText: "", headers: [], contentType: "application/json", body: new TextEncoder().encode('{"access_token":"x"}'), bodyTruncated: false, durationMs: 1, redirects: [] };
      },
    };
    const { agent, plan, environmentId } = await ready({ sender: slow });
    const first = agent.post(debugPath(plan.id)).send({ environmentId }).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await agent.post(debugPath(plan.id)).send({ environmentId });
    expect([second.status, second.body.error]).toEqual([409, "debug_run_in_progress"]);
    release();
    expect((await first).status).toBe(200);
    expect((await agent.post(debugPath(plan.id)).send({ environmentId })).status).toBe(200);
  });
});

describe("reveal and discard", () => {
  it("reveals one value that came from the target, never a secret, and forgets it on discard", async () => {
    const { agent, plan, environmentId } = await ready();
    const result = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    const segments = maskedSegments(result);
    const revealable = segments.find((segment) => segment.label === "Authorization header");
    const secret = segments.find((segment) => !segment.revealable);
    if (!revealable || !secret) throw new Error("expected both kinds of masked value");
    const valuePath = (valueId: string) => `${debugPath(plan.id)}/${result.debugRunId}/values/${valueId}`;

    const revealed = await agent.get(valuePath(revealable.valueId));
    expect(revealed.status).toBe(200);
    expect(revealed.headers["cache-control"]).toBe("no-store");
    expect(revealed.body).toEqual({ value: `Bearer ${TOKEN}` });
    const refused = await agent.get(valuePath(secret.valueId));
    expect([refused.status, refused.body.error]).toEqual([404, "debug_value_not_found"]);
    expect(refused.text).not.toContain(SECRET);

    expect((await agent.delete(`${debugPath(plan.id)}/${result.debugRunId}`)).status).toBe(204);
    expect((await agent.get(valuePath(revealable.valueId))).status).toBe(404);
  });

  it("answers the same 404 for an unknown, malformed or replaced value", async () => {
    const { agent, plan, environmentId } = await ready();
    const first = (await agent.post(debugPath(plan.id)).send({ environmentId })).body as DebugRunResult;
    const id = maskedSegments(first).find((segment) => segment.revealable)!.valueId;
    await agent.post(debugPath(plan.id)).send({ environmentId });
    const replaced = await agent.get(`${debugPath(plan.id)}/${first.debugRunId}/values/${id}`);
    const unknown = await agent.get(`${debugPath(plan.id)}/${first.debugRunId}/values/v99999`);
    const malformed = await agent.get(`${debugPath(plan.id)}/not-a-uuid/values/${id}`);
    for (const response of [replaced, unknown, malformed]) expect([response.status, response.body.error]).toEqual([404, "debug_value_not_found"]);
    expect(new Set([replaced.body.message, unknown.body.message, malformed.body.message]).size).toBe(1);
  });

  it("does not let another session reveal a value", async () => {
    const owner = await ready();
    const result = (await owner.agent.post(debugPath(owner.plan.id)).send({ environmentId: owner.environmentId })).body as DebugRunResult;
    const id = maskedSegments(result).find((segment) => segment.revealable)!.valueId;
    const other = await chainAgent({ debugSender: fakeSender(customers()).sender });
    const response = await other.agent.get(`${debugPath(owner.plan.id)}/${result.debugRunId}/values/${id}`);
    expect(response.status).toBe(404);
  });
});

describe("a Debug run leaves nothing behind", () => {
  function captureLogs(): string[] {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    return lines;
  }

  function tableText(): { name: string; text: string }[] {
    const db = getSharedConnection().db;
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name);
    return names.map((name) => ({
      name,
      text: JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all(), (_key, value: unknown) => (Buffer.isBuffer(value) ? value.toString("latin1") : value)),
    }));
  }

  it("keeps every sentinel out of every table, log line and later response (SC-002)", async () => {
    const logs = captureLogs();
    const respond = (request: SandboxRequest): SandboxResponse => customers()(request);
    const fake = fakeSender(respond);
    const { agent, plan, environmentId } = await (async () => {
      const { agent: a, sessionId } = await chainAgent({ debugSender: fake.sender });
      void sessionId;
      const created = await newPlan(a);
      const env = await createEnvironment(a, VALUES);
      await a.post(`${CHAIN_BASE}/${created.id}/data-sets`).field("name", "logins").field("mode", "row-per-iteration").attach("file", Buffer.from(`username,password\nada,${CELL}\n`), "logins.csv");
      const current = (await a.get(`${CHAIN_BASE}/${created.id}`)).body.plan as ChainPlan;
      await a.put(`${CHAIN_BASE}/${created.id}/data-sets/${current.dataSets[0].id}`).send({ name: "logins", mode: "row-per-iteration", columns: [{ name: "username", secret: false }, { name: "password", secret: true }] });
      const content = customerLifecyclePlan({ targetEnvironmentId: env });
      content.chains[0].steps[1] = {
        ...content.chains[0].steps[1],
        body: { kind: "raw", contentType: "application/json", text: `{"note":"${REQUEST_MARK}","password":"{{password}}"}` },
      };
      const saved = await savePlanContent(a, current, content);
      expect(saved.status).toBe(200);
      return { agent: a, plan: saved.body.plan as ChainPlan, environmentId: env };
    })();

    const responses: string[] = [];
    const run = await agent.post(debugPath(plan.id)).send({ environmentId });
    expect(run.status).toBe(200);
    responses.push(run.text);
    const result = run.body as DebugRunResult;
    // The engineer sees the response and request content in the run's own answer...
    expect(run.text).toContain(RESPONSE_MARK);
    expect(run.text).toContain(REQUEST_MARK);
    // ...and the data set secret and the credentials are masked even there.
    for (const sentinel of [SECRET, CELL, TOKEN]) expect(run.text, sentinel).not.toContain(sentinel);

    const revealable = maskedSegments(result).find((segment) => segment.revealable)!;
    responses.push((await agent.get(`${debugPath(plan.id)}/${result.debugRunId}/values/${revealable.valueId}`)).text);
    responses.push((await agent.get(`${CHAIN_BASE}/${plan.id}/runs`)).text);
    responses.push((await agent.get(`${CHAIN_BASE}/${plan.id}`)).text);
    await agent.delete(`${debugPath(plan.id)}/${result.debugRunId}`);

    const tables = tableText();
    const logText = logs.join("\n");
    // The plan holds the engineer's own text, so the request marker is in the plan, and only there.
    for (const { name, text } of tables) {
      for (const sentinel of [RESPONSE_MARK, SECRET, CELL, TOKEN]) expect(text, `${name}: ${sentinel}`).not.toContain(sentinel);
      if (name !== "chain_plans") expect(text, `${name}: request`).not.toContain(REQUEST_MARK);
    }
    for (const sentinel of [RESPONSE_MARK, SECRET, CELL, TOKEN, REQUEST_MARK]) expect(logText, sentinel).not.toContain(sentinel);
    // Later responses (the plan, the runs list) carry none of the run's content or values.
    const later = [responses[2], responses[3]].join("\n");
    for (const sentinel of [RESPONSE_MARK, SECRET, CELL, TOKEN]) expect(later, sentinel).not.toContain(sentinel);
    // No performance run was created.
    expect(tables.find((table) => table.name === "performance_runs")?.text).toBe("[]");
  });

  it("lists nothing after the run and shows nothing on a later read of the plan", async () => {
    const { agent, plan, environmentId } = await ready();
    await agent.post(debugPath(plan.id)).send({ environmentId });
    const view = await agent.get(`${CHAIN_BASE}/${plan.id}`);
    expect(view.text).not.toContain("debugRunId");
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}/runs`)).body.runs).toEqual([]);
  });
});
