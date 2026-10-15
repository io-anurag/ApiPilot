import { describe, expect, it } from "vitest";
import { readyProbe, unavailableProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { environmentFor, scriptFixture, uploadScript, USER_SCRIPTS_BASE, userScriptAgent } from "../../fixtures/userScripts/agent";

/**
 * AP-053 specs/053-user-script-debug-run (FR-001 to FR-007; SC-001 to SC-003; constitution v3.1.0, XVII).
 * The fake runner stands in for k6 and replays k6's `--log-format json` stderr, so no test here needs k6.
 */

const record = (msg: string, requestId: string, extra: Record<string, unknown> = {}) => JSON.stringify({ source: "http-debug", level: "info", msg, request_id: requestId, vu: 1, iter: 0, ...extra });

const SECRET_ENV = "SECRET-ENV-VALUE-123";
const SECRET_BODY_TOKEN = "SECRET-BODY-TOKEN-9";

/** One failing GET with an environment value in its header, then a POST whose response carries a token. */
function exchangeLines(): string[] {
  return [
    JSON.stringify({ source: "console", level: "info", msg: `console says ${SECRET_ENV}` }),
    record(`Request:\nGET /orders?page=1 HTTP/1.1\nHost: 127.0.0.1:4600\nX-Api-Key: ${SECRET_ENV}\nAuthorization: Bearer SECRET-BEARER-77\nCookie: sid=SECRET-COOKIE-55\n\n\n`, "a1", { name: "GET /orders" }),
    record('Response:\nHTTP/1.1 500 Internal Server Error\nContent-Length: 25\nContent-Type: application/json\nSet-Cookie: sid=SECRET-COOKIE-55; HttpOnly\n\n{"error":"boom","hint":"x"}\n', "a1", { name: "GET /orders" }),
    record(`Request:\nPOST /orders HTTP/1.1\nHost: 127.0.0.1:4600\nContent-Type: application/json\n\n{"key":"${SECRET_ENV}"}\n`, "b2", { name: "POST /orders" }),
    record(`Response:\nHTTP/1.1 201 Created\nContent-Type: application/json\nContent-Length: 40\n\n{"id":9,"access_token":"${SECRET_BODY_TOKEN}"}\n`, "b2", { name: "POST /orders" }),
    record("Request:\nGET /drop HTTP/1.1\nHost: 127.0.0.1:4600\n\n\n", "c3"),
  ];
}

async function confirmedScript(agent: Awaited<ReturnType<typeof userScriptAgent>>["agent"]) {
  const uploaded = await uploadScript(agent, scriptFixture("accepted", "basic.js"));
  expect(uploaded.status).toBe(201);
  const script = uploaded.body.script;
  const confirmed = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/confirmation`).send({ sha256: script.sha256 });
  expect(confirmed.status).toBe(200);
  return confirmed.body.script;
}

async function setup(runnerOptions: Parameters<typeof createFakeRunner>[0], extraDeps: Record<string, unknown> = {}) {
  const runner = createFakeRunner(runnerOptions);
  const { agent } = await userScriptAgent({ runner, probe: readyProbe(), ...extraDeps });
  const script = await confirmedScript(agent);
  const environmentId = await environmentFor(agent, { API_KEY: SECRET_ENV });
  const debugUrl = `${USER_SCRIPTS_BASE}/${script.id}/debug-runs`;
  const body = { environmentId, scriptSha256: script.sha256 };
  return { runner, agent, script, environmentId, debugUrl, body };
}

describe("Debug run of a supplied script", () => {
  it("runs the pinned one-iteration arguments and returns every exchange, with no run record", async () => {
    const { runner, agent, debugUrl, body, script } = await setup({ lines: [], stderrLines: exchangeLines() });
    const response = await agent.post(debugUrl).send(body);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const result = response.body;
    expect(result).toMatchObject({ scriptId: script.id, scriptSha256: script.sha256, outcome: "completed", k6ExitCode: 0 });
    expect(result.exchanges).toHaveLength(3);
    expect(result.exchanges.map((exchange: { index: number }) => exchange.index)).toEqual([1, 2, 3]);
    expect(result.exchanges[0].response.status).toBe(500);
    expect(result.exchanges[2].response).toBeNull();
    expect(result.notes.join(" ")).toContain("one virtual user and one iteration");

    // What k6 was given: the pinned debug arguments, the confirmed script, no stages and no metrics output.
    const start = runner.starts[0];
    expect(start.args).toEqual(["run", "--no-usage-report", "--quiet", "--no-color", "--log-format", "json", "--http-debug=full", "--vus", "1", "--iterations", "1", start.scriptPath]);
    expect(start.env.API_KEY).toBe(SECRET_ENV);

    // No run record, no stored result (FR-006).
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs`)).body.runs).toEqual([]);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/${script.id}`)).body.script.lastRun).toBeNull();
  });

  it("masks environment values, credential headers and cookies, never shows console output, and keeps the environment value unrevealable", async () => {
    const { agent, debugUrl, body, script } = await setup({ lines: [], stderrLines: exchangeLines() });
    const response = await agent.post(debugUrl).send(body);
    const text = JSON.stringify(response.body);
    for (const secret of [SECRET_ENV, "SECRET-BEARER-77", "SECRET-COOKIE-55", "console says"]) expect(text).not.toContain(secret);

    const [get, post] = response.body.exchanges;
    const apiKey = get.request.headers.find((header: { name: string }) => header.name === "X-Api-Key");
    expect(apiKey.value).toEqual([expect.objectContaining({ kind: "masked", revealable: false })]);
    const authorization = get.request.headers.find((header: { name: string }) => header.name === "Authorization");
    expect(authorization.value).toEqual([expect.objectContaining({ kind: "masked", revealable: true })]);
    // The environment value inside a request body is masked too.
    const bodySegments = post.request.body.text as { kind: string; revealable?: boolean }[];
    expect(bodySegments.some((segment) => segment.kind === "masked" && segment.revealable === false)).toBe(true);

    // A revealable value is revealed one at a time; an environment value has no such id.
    const valueId = authorization.value[0].valueId as string;
    const revealed = await agent.get(`${debugUrl}/${response.body.debugRunId}/values/${valueId}`);
    expect(revealed.status).toBe(200);
    expect(revealed.body).toEqual({ value: "Bearer SECRET-BEARER-77" });
    const envId = apiKey.value[0].valueId as string;
    expect((await agent.get(`${debugUrl}/${response.body.debugRunId}/values/${envId}`)).status).toBe(404);

    // Discarding forgets it; so does asking for another run's id.
    expect((await agent.delete(`${debugUrl}/${response.body.debugRunId}`)).status).toBe(204);
    expect((await agent.get(`${debugUrl}/${response.body.debugRunId}/values/${valueId}`)).status).toBe(404);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/${script.id}/debug-runs/00000000-0000-4000-8000-000000000000/values/v1`)).status).toBe(404);
  });

  it("masks a credential found in a later response where an earlier request carried it", async () => {
    const lines = [
      record(`Request:\nGET /me HTTP/1.1\nHost: h\nX-Trace: ${SECRET_BODY_TOKEN}\n\n\n`, "a1"),
      record(`Response:\nHTTP/1.1 200 OK\nContent-Type: application/json\n\n{"access_token":"${SECRET_BODY_TOKEN}"}\n`, "a1"),
    ];
    const { agent, debugUrl, body } = await setup({ lines: [], stderrLines: lines });
    const text = JSON.stringify((await agent.post(debugUrl).send(body)).body);
    expect(text).not.toContain(SECRET_BODY_TOKEN);
  });

  it("is unavailable, with the same errors as a run, until the script is confirmed and current", async () => {
    const runner = createFakeRunner({ lines: [], stderrLines: exchangeLines() });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe() });
    const uploaded = (await uploadScript(agent, scriptFixture("accepted", "basic.js"))).body.script;
    const environmentId = await environmentFor(agent, {});
    const url = `${USER_SCRIPTS_BASE}/${uploaded.id}/debug-runs`;
    const unconfirmed = await agent.post(url).send({ environmentId, scriptSha256: uploaded.sha256 });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toBe("script_not_confirmed");

    await agent.post(`${USER_SCRIPTS_BASE}/${uploaded.id}/confirmation`).send({ sha256: uploaded.sha256 });
    const stale = await agent.post(url).send({ environmentId, scriptSha256: "0".repeat(64) });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("script_changed");
    const noEnvironment = await agent.post(url).send({ scriptSha256: uploaded.sha256 });
    expect(noEnvironment.status).toBeGreaterThanOrEqual(400);
    expect(runner.starts).toHaveLength(0);
  });

  it("refuses while k6 is unavailable, and for an unknown script", async () => {
    const runner = createFakeRunner({ lines: [] });
    const { agent } = await userScriptAgent({ runner, probe: unavailableProbe() });
    const script = await confirmedScript(agent);
    const environmentId = await environmentFor(agent, {});
    const unavailable = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/debug-runs`).send({ environmentId, scriptSha256: script.sha256 });
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error).toBe("k6_unavailable");
    expect((await agent.post(`${USER_SCRIPTS_BASE}/00000000-0000-4000-8000-000000000000/debug-runs`).send({})).status).toBe(404);
  });

  it("ignores the load profile: it runs even for a script with no default function, and passes no stages", async () => {
    const runner = createFakeRunner({ lines: [], stderrLines: exchangeLines() });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe() });
    const script = await confirmedScript(agent);
    const environmentId = await environmentFor(agent, { API_KEY: SECRET_ENV });
    await agent.put(`${USER_SCRIPTS_BASE}/${script.id}/settings`).send({
      mapping: script.settings.mapping.map(({ name, source }: { name: string; source: unknown }) => ({ name, source })),
      removedNames: [],
      load: { kind: "profile", profile: { kind: "smoke", stages: [{ durationMs: 30_000, targetVirtualUsers: 20 }], plannedDurationMs: 30_000 } },
      thresholds: [],
    });
    const response = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/debug-runs`).send({ environmentId, scriptSha256: script.sha256 });
    expect(response.status).toBe(200);
    expect(runner.starts[0].args).not.toContain("--stage");
    expect(response.body.notes.join(" ")).toContain("load profile and the thresholds set in ApiPilot did not apply");
  });

  it("says no request was sent, fails with k6's own message, and cuts off at the limits", async () => {
    const none = await setup({ lines: [] });
    expect((await none.agent.post(none.debugUrl).send(none.body)).body).toMatchObject({ outcome: "no-requests", exchanges: [] });

    const failed = await setup({ lines: [], exitCode: 107, stderrLines: [JSON.stringify({ level: "error", msg: `GoError: boom ${SECRET_ENV}` })] });
    const failure = (await failed.agent.post(failed.debugUrl).send(failed.body)).body;
    expect(failure.outcome).toBe("failed");
    expect(failure.k6ExitCode).toBe(107);
    expect(failure.k6Message).toContain("GoError: boom");
    expect(failure.k6Message).not.toContain(SECRET_ENV);

    const many = await setup({ lines: [], holdUntilCancelled: true, stderrLines: exchangeLines() }, { debugLimits: { maxExchanges: 2 } });
    const capped = (await many.agent.post(many.debugUrl).send(many.body)).body;
    expect(capped).toMatchObject({ outcome: "cut-off", cutOffReason: "exchange-limit" });
    expect(capped.exchanges).toHaveLength(2);
    expect(many.runner.cancels).toBe(1);

    const slow = await setup({ lines: [], holdUntilCancelled: true }, { debugLimits: { timeLimitMs: 30 } });
    expect((await slow.agent.post(slow.debugUrl).send(slow.body)).body).toMatchObject({ outcome: "cut-off", cutOffReason: "time-limit" });
  });

  it("refuses a second Debug run of the script while one is running, and cancels k6 when the request is aborted", async () => {
    const { runner, agent, debugUrl, body } = await setup({ lines: [], holdUntilCancelled: true });
    const first = agent.post(debugUrl).send(body);
    const pending = first.then(
      () => undefined,
      () => undefined,
    );
    for (let attempt = 0; attempt < 100 && runner.starts.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runner.starts).toHaveLength(1);
    const second = await agent.post(debugUrl).send(body);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("debug_run_in_progress");
    first.abort();
    await pending;
    for (let attempt = 0; attempt < 100 && runner.cancels === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runner.cancels).toBe(1);
  });

  it("does not start while an execution holds the slot", async () => {
    const { runner, agent, script, environmentId, debugUrl, body } = await setup({ lines: [], holdUntilCancelled: true });
    const run = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
    expect(run.status).toBe(200);
    const blocked = await agent.post(debugUrl).send(body);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("execution_in_progress");
    expect(runner.starts).toHaveLength(1);
    await agent.post(`${USER_SCRIPTS_BASE}/runs/${run.body.run.id}/cancel`);
  });

  it("gives the same result for the same k6 records", async () => {
    const [a, b] = [await setup({ lines: [], stderrLines: exchangeLines() }), await setup({ lines: [], stderrLines: exchangeLines() })];
    const first = (await a.agent.post(a.debugUrl).send(a.body)).body;
    const second = (await b.agent.post(b.debugUrl).send(b.body)).body;
    expect(second.exchanges).toEqual(first.exchanges);
  });
});
