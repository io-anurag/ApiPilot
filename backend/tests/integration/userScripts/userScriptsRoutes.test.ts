import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptCheckResult } from "@apipilot/shared-domain";
import { USER_SCRIPT_MAX_BYTES } from "@apipilot/shared-domain";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { getUserScriptRunRepository } from "../../../src/persistence/userScriptRunRepository";
import { recoverUserScriptRunsAtStartup } from "../../../src/performance/startup";
import { setScriptCheckForTest } from "../../../src/performance/userScript/userScriptStore";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { readyProbe, unavailableProbe } from "../../fixtures/performance/agent";
import { runFixture } from "../../fixtures/performance/builders";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { environmentFor, scriptFixture, uploadScript, USER_SCRIPTS_BASE, userScriptAgent, waitUntilSettled } from "../../fixtures/userScripts/agent";
import { basicLines } from "../../fixtures/userScripts/ndjsonBuilder";

/**
 * AP-034 contracts/user-scripts-api.md (FR-002 to FR-023, FR-029, FR-030, FR-039 to FR-041;
 * SC-002, SC-003, SC-008; research R6 to R9, R13, R17; tasks T025). The fake runner stands in for
 * k6, so no test here needs k6.
 */

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

afterEach(() => setScriptCheckForTest(null));

async function confirmed(agent: Awaited<ReturnType<typeof userScriptAgent>>["agent"], bytes = scriptFixture("accepted", "basic.js")) {
  const uploaded = await uploadScript(agent, bytes);
  expect(uploaded.status).toBe(201);
  const script = uploaded.body.script;
  const confirmation = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/confirmation`).send({ sha256: script.sha256 });
  expect(confirmation.status).toBe(200);
  return confirmation.body.script;
}

describe("uploading and listing scripts", () => {
  it("stores an accepted script needing confirmation, with its hosts, names and SHA-256", async () => {
    const { agent } = await userScriptAgent();
    const bytes = scriptFixture("accepted", "unnamed-urls.js");
    const uploaded = await uploadScript(agent, bytes, "Customers");
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.script).toMatchObject({
      name: "Customers",
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      confirmed: false,
      confirmation: null,
      check: { accepted: true, hosts: ["https://api.example.test:8443"], envNames: [{ name: "API_KEY" }, { name: "BASE_URL" }] },
      settings: {
        mapping: [
          { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, foundInScript: true },
          { name: "BASE_URL", source: { kind: "base-url" }, foundInScript: true },
        ],
        load: { kind: "script" },
      },
    });
    expect(uploaded.body.script).not.toHaveProperty("content");
    const list = await agent.get(USER_SCRIPTS_BASE);
    expect(list.body.scripts.map((script: { id: string }) => script.id)).toEqual([uploaded.body.script.id]);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/${uploaded.body.script.id}/content`)).text).toBe(bytes.toString("utf-8"));
  });

  it("refuses each rule category with its reasons and stores nothing (FR-004)", async () => {
    const { agent } = await userScriptAgent();
    for (const file of ["import-remote.js", "open-call.js", "computed-key.js", "handle-summary-fn.js", "parse-error.js"]) {
      const refused = await uploadScript(agent, scriptFixture("refused", file));
      expect(refused.status).toBe(422);
      expect(refused.body.error).toBe("script_refused");
      expect(refused.body.problems.length).toBeGreaterThan(0);
    }
    expect((await agent.get(USER_SCRIPTS_BASE)).body.scripts).toEqual([]);
    expect(getSharedConnection().db.prepare("SELECT COUNT(*) AS n FROM user_scripts").get()).toEqual({ n: 0 });
  });

  it("refuses a body over 1 MiB with 413 and any other content type with 415", async () => {
    const { agent } = await userScriptAgent();
    expect((await uploadScript(agent, Buffer.alloc(USER_SCRIPT_MAX_BYTES + 1, 0x20))).status).toBe(413);
    const wrongType = await agent.post(`${USER_SCRIPTS_BASE}/upload`).set("Content-Type", "text/plain").send("export default function () {}");
    expect(wrongType.status).toBe(415);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    const { agent } = await userScriptAgent();
    expect((await agent.get(`${USER_SCRIPTS_BASE}/not-a-uuid`)).body.error).toBe("script_not_found");
    expect((await agent.get(`${USER_SCRIPTS_BASE}/00000000-0000-4000-8000-000000000000`)).body.error).toBe("script_not_found");
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs/nope`)).body.error).toBe("run_not_found");
  });
});

describe("confirmation (FR-013 to FR-016)", () => {
  it("binds the confirmation to the SHA-256 shown, keeps it on rename, and confirms one script only", async () => {
    const { agent } = await userScriptAgent();
    const bytes = scriptFixture("accepted", "basic.js");
    const first = (await uploadScript(agent, bytes, "First")).body.script;
    const second = (await uploadScript(agent, bytes, "Second")).body.script;
    expect(second.confirmed).toBe(false);

    const stale = await agent.post(`${USER_SCRIPTS_BASE}/${first.id}/confirmation`).send({ sha256: "0".repeat(64) });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("script_changed");

    const confirmedFirst = await agent.post(`${USER_SCRIPTS_BASE}/${first.id}/confirmation`).send({ sha256: first.sha256 });
    expect(confirmedFirst.body.script).toMatchObject({ confirmed: true, confirmation: { sha256: first.sha256, hostsStated: [] } });
    expect((await agent.get(`${USER_SCRIPTS_BASE}/${second.id}`)).body.script.confirmed).toBe(false);

    const renamed = await agent.patch(`${USER_SCRIPTS_BASE}/${first.id}`).send({ name: "Renamed" });
    expect(renamed.body.script).toMatchObject({ name: "Renamed", confirmed: true });
  });
});

describe("starting a run (research R17)", () => {
  it("refuses in order: changed rules, unconfirmed, wrong SHA-256, k6 not ready, unknown environment, slot busy", async () => {
    const unready = await userScriptAgent({ runner: createFakeRunner({ lines: [] }), probe: unavailableProbe() });
    const script = (await uploadScript(unready.agent, scriptFixture("accepted", "basic.js"))).body.script;
    const environmentId = await environmentFor(unready.agent);
    const start = (body: Record<string, unknown>) => unready.agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256, ...body });

    expect((await start({})).body.error).toBe("script_not_confirmed");
    await unready.agent.post(`${USER_SCRIPTS_BASE}/${script.id}/confirmation`).send({ sha256: script.sha256 });
    expect((await start({ scriptSha256: "0".repeat(64) })).body.error).toBe("script_changed");
    expect((await start({})).body.error).toBe("k6_unavailable");

    // A stricter check in a later release refuses a confirmed script before anything else.
    setScriptCheckForTest((): ScriptCheckResult => ({ accepted: false, problems: [{ rule: "computed-access", line: 1, column: 1, message: "stricter" }] }));
    const refused = await start({});
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("script_refused");
    setScriptCheckForTest(null);

    const ready = await userScriptAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    const readyScript = await confirmed(ready.agent);
    const readyEnvironment = await environmentFor(ready.agent);
    const readyStart = (body: Record<string, unknown>) => ready.agent.post(`${USER_SCRIPTS_BASE}/${readyScript.id}/runs`).send({ environmentId: readyEnvironment, scriptSha256: readyScript.sha256, ...body });
    expect((await readyStart({ environmentId: "missing" })).body.error).toBe("environment_not_found");
    getPerformanceRunRepository().create(ready.sessionId, runFixture({ id: "occupying" }));
    const busy = await readyStart({});
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: "execution_in_progress", runId: "occupying" });
  }, 60_000);

  it("runs a copy of the confirmed bytes with the mapped values, reports it, and removes the copy (SC-003, FR-041)", async () => {
    const runDirectoryRoot = mkdtempSync(path.join(tmpdir(), "apipilot-user-script-"));
    const runner = createFakeRunner({ lines: basicLines(), lineIntervalMs: 1, exitCode: 99 });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe(), tickIntervalMs: 20, runDirectoryRoot });
    const bytes = scriptFixture("accepted", "basic.js");
    const script = await confirmed(agent, bytes);
    const environmentId = await environmentFor(agent, { API_KEY: "seeded-api-key-value" });
    expect(runner.starts).toHaveLength(0);

    const started = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
    expect(started.status).toBe(200);
    expect(started.body.run).toMatchObject({ source: "user-script", status: "in-progress", snapshot: { scriptSha256: sha256(bytes), scriptName: "Orders" } });
    expect(runner.starts).toHaveLength(1);
    const input = runner.starts[0];
    expect(input.env).toMatchObject({ BASE_URL: "http://127.0.0.1:4600", API_KEY: "seeded-api-key-value" });
    expect(input.args).toContain("--log-format");
    expect(input.args!.join(" ")).not.toContain("seeded-api-key-value");

    const settled = await waitUntilSettled(agent, started.body.run.id);
    expect(settled).toMatchObject({ status: "completed", k6ExitCode: 99, exitMeaning: "script-thresholds-crossed" });
    expect(settled.result.totals.requests).toBe(30);
    expect(settled.result.scriptThresholdsOutcome).toBe("crossed");
    expect(readdirSync(runDirectoryRoot)).toEqual([]);

    const report = await agent.get(`${USER_SCRIPTS_BASE}/runs/${settled.id}/report`);
    expect(report.status).toBe(200);
    expect(report.text).toContain("Script supplied by the engineer");
    expect(report.text).toContain(sha256(bytes));
    expect(report.text).not.toContain("seeded-api-key-value");
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs?scriptId=${script.id}`)).body.runs.map((run: { id: string }) => run.id)).toEqual([settled.id]);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/${script.id}`)).body.script.lastRun).toMatchObject({ runId: settled.id, status: "completed" });
  }, 60_000);

  it("records a failed start with k6's message on the run only, never in the list, report or logs (FR-029)", async () => {
    const runner = createFakeRunner({
      lines: [],
      exitCode: 107,
      stderrLines: [JSON.stringify({ level: "info", msg: "console-secret", source: "console" }), JSON.stringify({ level: "error", msg: "ReferenceError: x is not defined at file:///script.js:3:5" })],
    });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
    const script = await confirmed(agent);
    const environmentId = await environmentFor(agent);
    const started = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
    const settled = await waitUntilSettled(agent, started.body.run.id);
    expect(settled).toMatchObject({ status: "failed", exitMeaning: "script-exception", failure: { category: "k6-exited-with-error", k6Message: "ReferenceError: x is not defined at file:///script.js:3:5" } });
    expect(JSON.stringify(settled)).not.toContain("console-secret");
    const [summary] = (await agent.get(`${USER_SCRIPTS_BASE}/runs`)).body.runs;
    expect(summary.failure).toEqual({ category: "k6-exited-with-error" });
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs/${settled.id}/report`)).text).not.toContain("ReferenceError");
  }, 60_000);

  it("refuses a run when the stored bytes changed after confirmation, until confirmed again (SC-002)", async () => {
    const { agent } = await userScriptAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    const script = await confirmed(agent);
    const environmentId = await environmentFor(agent);
    const edited = await agent.put(`${USER_SCRIPTS_BASE}/${script.id}/content`).send({ content: "export default function () { }\n", baseSha256: script.sha256 });
    expect(edited.body.script.confirmed).toBe(false);
    const refused = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: edited.body.script.sha256 });
    expect(refused.body.error).toBe("script_not_confirmed");
  }, 60_000);

  it("cancels on request, reports 409 while in progress, refuses deletion until the run ends, then keeps the run", async () => {
    const runner = createFakeRunner({ lines: basicLines(), lineIntervalMs: 5, holdUntilCancelled: true });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
    const script = await confirmed(agent);
    const environmentId = await environmentFor(agent);
    const started = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
    const runId = started.body.run.id;
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs/${runId}/report`)).status).toBe(409);
    const deleteWhileRunning = await agent.delete(`${USER_SCRIPTS_BASE}/${script.id}`);
    expect(deleteWhileRunning.body).toMatchObject({ error: "run_in_progress", runId });
    expect((await agent.post(`${USER_SCRIPTS_BASE}/runs/${runId}/cancel`)).status).toBe(202);
    const settled = await waitUntilSettled(agent, runId);
    expect(settled).toMatchObject({ status: "cancelled", cancelReason: "user-requested" });
    expect((await agent.delete(`${USER_SCRIPTS_BASE}/${script.id}`)).status).toBe(204);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs/${runId}`)).status).toBe(200);
  }, 60_000);

  it("starts no run on upload, confirmation or settings (FR-020, SC-008)", async () => {
    const runner = createFakeRunner({ lines: [] });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe() });
    const script = await confirmed(agent);
    await agent.put(`${USER_SCRIPTS_BASE}/${script.id}/settings`).send({ mapping: [], removedNames: [], load: { kind: "script" }, thresholds: [] });
    expect(runner.starts).toHaveLength(0);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs`)).body.runs).toEqual([]);
  });
});

describe("restart and session expiry", () => {
  it("marks an in-progress run cancelled for a backend restart and starts nothing", async () => {
    const { sessionId } = await userScriptAgent();
    getUserScriptRunRepository().create(sessionId, {
      id: "11111111-1111-4111-8111-111111111111",
      source: "user-script",
      status: "in-progress",
      environment: { id: "e", name: "e", tier: "local", baseUrl: "http://127.0.0.1:9" },
      snapshot: { scriptId: "s", scriptName: "s", scriptSha256: "x", load: { kind: "script" }, mapping: [], thresholds: [], hostsFound: [] },
      k6Version: "1.2.0",
      k6ExitCode: null,
      exitMeaning: null,
      plannedDurationMs: null,
      startedAt: "2026-10-01T10:00:00.000Z",
      cancelRequested: false,
    });
    recoverUserScriptRunsAtStartup();
    expect(getUserScriptRunRepository().get(sessionId, "11111111-1111-4111-8111-111111111111")).toMatchObject({ status: "cancelled", cancelReason: "backend-restart" });
  });

  it("deletes the session's scripts and runs when it expires", async () => {
    const { agent, sessionId } = await userScriptAgent();
    await uploadScript(agent, scriptFixture("accepted", "basic.js"));
    forceExpireForTest(sessionId);
    expect(getSharedConnection().db.prepare("SELECT COUNT(*) AS n FROM user_scripts WHERE session_id = ?").get(sessionId)).toEqual({ n: 0 });
    expect(getSharedConnection().db.prepare("SELECT COUNT(*) AS n FROM user_script_runs WHERE session_id = ?").get(sessionId)).toEqual({ n: 0 });
  });
});
