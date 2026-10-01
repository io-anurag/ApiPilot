import { afterEach, describe, expect, it, vi } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { environmentFor, scriptFixture, uploadScript, USER_SCRIPTS_BASE, userScriptAgent, waitUntilSettled } from "../../fixtures/userScripts/agent";
import { basicLines } from "../../fixtures/userScripts/ndjsonBuilder";

/** AP-034 US2 (FR-024 to FR-028, FR-038, SC-004; research R10 to R12; tasks T049). */

const SEEDED_KEY = "seeded-api-key-7d1e";
const SEEDED_OTHER = "seeded-other-value-93c2";

afterEach(() => vi.restoreAllMocks());

async function confirmedScript(agent: Awaited<ReturnType<typeof userScriptAgent>>["agent"], file = "basic.js") {
  const uploaded = (await uploadScript(agent, scriptFixture("accepted", file))).body.script;
  return (await agent.post(`${USER_SCRIPTS_BASE}/${uploaded.id}/confirmation`).send({ sha256: uploaded.sha256 })).body.script;
}

const settings = (overrides: Record<string, unknown> = {}) => ({
  mapping: [
    { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" } },
    { name: "BASE_URL", source: { kind: "base-url" } },
  ],
  removedNames: [],
  load: { kind: "script" },
  thresholds: [],
  ...overrides,
});

describe("run settings", () => {
  it("keeps the SHA-256 and the confirmation when settings change (FR-028), and refuses a bad name", async () => {
    const { agent } = await userScriptAgent();
    const script = await confirmedScript(agent);
    const saved = await agent.put(`${USER_SCRIPTS_BASE}/${script.id}/settings`).send(settings({ thresholds: [{ scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 500 }] }));
    expect(saved.status).toBe(200);
    expect(saved.body.script).toMatchObject({ sha256: script.sha256, confirmed: true, settings: { thresholds: [{ metric: "p95", limit: 500 }] } });

    const refused = await agent.put(`${USER_SCRIPTS_BASE}/${script.id}/settings`).send(settings({ mapping: [{ name: "PATH", source: { kind: "base-url" } }] }));
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "invalid_mapping_name", name: "PATH", reason: "reserved-startup-name" });
  });

  it("reports present and missing values for an environment and never returns a value", async () => {
    const { agent } = await userScriptAgent();
    const script = await confirmedScript(agent);
    const environmentId = await environmentFor(agent, { OTHER: SEEDED_OTHER });
    const values = await agent.get(`${USER_SCRIPTS_BASE}/${script.id}/values?environmentId=${environmentId}`);
    expect(values.body.values).toEqual([
      { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, present: false },
      { name: "BASE_URL", source: { kind: "base-url" }, present: true },
    ]);
    expect(values.text).not.toContain(SEEDED_OTHER);
  });

  it("passes mapped values in the child environment only, leaves a missing one unset, and records names only", async () => {
    const runner = createFakeRunner({ lines: basicLines(), lineIntervalMs: 1 });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
    const script = await confirmedScript(agent);
    await agent.put(`${USER_SCRIPTS_BASE}/${script.id}/settings`).send(settings({ mapping: [...settings().mapping, { name: "MISSING", source: { kind: "environment-value", valueName: "NOPE" } }] }));
    const environmentId = await environmentFor(agent, { API_KEY: SEEDED_KEY });
    const started = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
    expect(runner.starts[0].env).toMatchObject({ API_KEY: SEEDED_KEY, BASE_URL: "http://127.0.0.1:4600" });
    expect(runner.starts[0].env).not.toHaveProperty("MISSING");
    expect(started.body.run.snapshot.mapping).toEqual([
      { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" } },
      { name: "BASE_URL", source: { kind: "base-url" } },
      { name: "MISSING", source: { kind: "environment-value", valueName: "NOPE" } },
    ]);
    await waitUntilSettled(agent, started.body.run.id);
  }, 60_000);

  it("passes a load profile as --stage options and records it; refuses it for a script with no default function (FR-027)", async () => {
    const runner = createFakeRunner({ lines: [], lineIntervalMs: 1 });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
    const profile = { kind: "profile", profile: { kind: "smoke", stages: [{ durationMs: 20_000, targetVirtualUsers: 3 }] } };
    const script = await confirmedScript(agent);
    await agent.put(`${USER_SCRIPTS_BASE}/${script.id}/settings`).send(settings({ load: profile }));
    const environmentId = await environmentFor(agent);
    const started = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
    expect(started.body.run).toMatchObject({ plannedDurationMs: 20_000, snapshot: { load: { kind: "profile", profile: { stages: [{ durationMs: 20_000, targetVirtualUsers: 3 }] } } } });
    expect(runner.starts[0].args).toEqual(expect.arrayContaining(["--stage", "20s:3"]));
    await waitUntilSettled(agent, started.body.run.id);

    const scenariosOnly = await confirmedScript(agent, "scenarios-only.js");
    await agent.put(`${USER_SCRIPTS_BASE}/${scenariosOnly.id}/settings`).send(settings({ mapping: [], load: profile }));
    const refused = await agent.post(`${USER_SCRIPTS_BASE}/${scenariosOnly.id}/runs`).send({ environmentId, scriptSha256: scenariosOnly.sha256 });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("load_override_unavailable");
  }, 60_000);
});

describe("seeded-secret scan (SC-004, FR-038, FR-039)", () => {
  it("finds no environment value in any response, the report, the database or the logs", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
    const runner = createFakeRunner({
      lines: basicLines(),
      lineIntervalMs: 1,
      stderrLines: [JSON.stringify({ level: "info", msg: SEEDED_KEY, source: "console" })],
    });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
    const script = await confirmedScript(agent);
    const environmentId = await environmentFor(agent, { API_KEY: SEEDED_KEY, OTHER: SEEDED_OTHER });
    const bodies: string[] = [];
    bodies.push((await agent.get(`${USER_SCRIPTS_BASE}/${script.id}`)).text);
    bodies.push((await agent.get(`${USER_SCRIPTS_BASE}/${script.id}/values?environmentId=${environmentId}`)).text);
    const started = await agent.post(`${USER_SCRIPTS_BASE}/${script.id}/runs`).send({ environmentId, scriptSha256: script.sha256 });
    bodies.push(started.text);
    const settled = await waitUntilSettled(agent, started.body.run.id);
    bodies.push(JSON.stringify(settled));
    bodies.push((await agent.get(`${USER_SCRIPTS_BASE}/runs`)).text);
    bodies.push((await agent.get(`${USER_SCRIPTS_BASE}/runs/${settled.id}/report`)).text);

    const tables = ["user_scripts", "user_script_runs"].map((table) =>
      (getSharedConnection().db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[])
        .map((row) => Object.values(row).map((value) => (Buffer.isBuffer(value) ? value.toString("latin1") : String(value))).join("|"))
        .join("\n"),
    );
    for (const secret of [SEEDED_KEY, SEEDED_OTHER]) {
      for (const text of [...bodies, ...tables, ...logged]) expect(text).not.toContain(secret);
    }
  }, 60_000);
});
