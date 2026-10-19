import { afterEach, describe, expect, it, vi } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getSecurityEvidenceRepository } from "../../../src/persistence/securityEvidenceRepository";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import { approve, generateAll, scenarioIds, startHarness, startRun, waitForRun, type Harness } from "../../fixtures/securityLab/runHarness";
import {
  ALL_SECRETS,
  SECRET_API_KEY,
  SECRET_BASIC_PASSWORD,
  SECRET_BEARER_TOKEN,
  SECRET_COOKIE_VALUE,
  SECRET_ERROR_TEXT,
  SECRET_JSON_TOKEN,
  SECRET_PASSWORD_FIELD,
  SECRET_SHAPED_RESPONSE_FIELD,
  assertNoSecrets,
} from "../../fixtures/securityLab/secretCorpus";

/**
 * specs/057 SC-009, FR-048 to FR-052, tasks T112: every seeded secret is put into the credentials a profile holds and
 * into the responses a target sends (headers, bodies, error text), a run is carried out end to end, and no stored or
 * logged artifact may contain any of them: not the redacted evidence, not the observed summaries, not the retained
 * run rows, not the findings, and not the logs. Report and export are added to this list by their own tasks.
 */

const BASE = "/api/security-lab";
const harnesses: Harness[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await settleActiveRuns();
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
});

/** The credential values the profile holds: the ones a run resolves and the sender puts on the wire. */
const CREDENTIALS = { aliceBearer: SECRET_BEARER_TOKEN, bobBearer: SECRET_ERROR_TEXT, aliceKey: SECRET_API_KEY, bobKey: SECRET_BASIC_PASSWORD };
/** Every value that must be absent: the credentials, and the secrets only a response carries. */
const MUST_BE_ABSENT = [SECRET_BEARER_TOKEN, SECRET_API_KEY, SECRET_ERROR_TEXT, SECRET_BASIC_PASSWORD, SECRET_PASSWORD_FIELD, SECRET_JSON_TOKEN, SECRET_SHAPED_RESPONSE_FIELD, SECRET_COOKIE_VALUE];

async function seededRun() {
  const logged: string[] = [];
  for (const method of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }

  const h = await startHarness({ behavior: { vulnerable: true }, profile: { destructivePermitted: true } });
  harnesses.push(h);
  // The target answers every request with a body that carries every seeded secret, and echoes what it was sent.
  h.target.setHandler((request, response) => {
    response
      .writeHead(200, { "content-type": "application/json", "set-cookie": `sid=${SECRET_COOKIE_VALUE}`, "x-debug-token": SECRET_BEARER_TOKEN, "www-authenticate": `Bearer realm="${SECRET_ERROR_TEXT}"` })
      .end(
        JSON.stringify({
          error: `bad credential ${SECRET_ERROR_TEXT}`,
          access_token: SECRET_JSON_TOKEN,
          password: SECRET_PASSWORD_FIELD,
          note: SECRET_SHAPED_RESPONSE_FIELD,
          cookie: SECRET_COOKIE_VALUE,
          echoedAuthorization: request.headers.authorization ?? null,
          echoedKey: request.headers["x-api-key"] ?? null,
          trace: `at Object.handler (/srv/app/server.js:1:1) while using ${SECRET_API_KEY}`,
        }),
      );
  });
  // Replace the fixture credentials with the seeded ones.
  for (const [identity, scheme, value] of [["alice", "bearerAuth", CREDENTIALS.aliceBearer], ["bob", "bearerAuth", CREDENTIALS.bobBearer], ["alice", "apiKeyAuth", CREDENTIALS.aliceKey], ["bob", "apiKeyAuth", CREDENTIALS.bobKey]]) {
    expect((await h.agent.put(`${BASE}/profiles/${h.profileId}/credentials`).send({ identity, scheme, kind: "active", value })).status).toBe(204);
  }

  await generateAll(h);
  const items = [
    ...(await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`)),
    ...(await scenarioIds(h, `operation=${encodeURIComponent("GET /orders/{orderId}")}&category=broken-object-level-authorization`)),
    // A request that sends a valid credential of the owner identity (the others send none, an invalid one, or the other identity's).
    ...(await scenarioIds(h, `operation=${encodeURIComponent("POST /orders")}&category=input-validation`)).slice(0, 2),
  ];
  await approve(h, items);
  const started = await startRun(h, items);
  expect(started.status, JSON.stringify(started.body.problems ?? started.body)).toBe(202);
  const detail = await waitForRun(h, started.body.run.id);
  return { h, items, detail, logged };
}

describe("a run with every secret seeded", () => {
  it("sends the seeded credentials, so the test is meaningful", async () => {
    const { h } = await seededRun();
    const wire = JSON.stringify(h.target.requests.map((entry) => entry.headers));
    expect(wire).toContain(SECRET_BEARER_TOKEN);
    expect(wire).toContain(SECRET_ERROR_TEXT);
    // The owner's API key is held by the profile but no selected scenario sends it, so it can reach evidence only through an echo.
    expect(wire).not.toContain(SECRET_API_KEY);
  });

  it("leaves none of them in the redacted evidence", async () => {
    const { h, detail } = await seededRun();
    expect(detail.results.length).toBeGreaterThan(3);
    for (const result of detail.results as Array<{ id: string; evidenceCount: number }>) {
      const records = getSecurityEvidenceRepository().list(h.sessionId, result.id);
      expect(records).toHaveLength(result.evidenceCount);
      assertNoSecrets(`evidence of ${result.id}`, JSON.stringify(records), MUST_BE_ABSENT);
    }
  });

  it("leaves none of them in the run, its results or its observed summaries, as the routes return them", async () => {
    const { h, detail } = await seededRun();
    assertNoSecrets("run detail", JSON.stringify(detail), MUST_BE_ABSENT);
    assertNoSecrets("run list", (await h.agent.get(`${BASE}/runs`)).text, MUST_BE_ABSENT);
    for (const result of detail.results as Array<{ scenarioId: string }>) {
      const withEvidence = await h.agent.get(`${BASE}/runs/${detail.run.id}?evidence=true&scenarioId=${result.scenarioId}`);
      assertNoSecrets(`evidence route for ${result.scenarioId}`, withEvidence.text, MUST_BE_ABSENT);
    }
  });

  it("leaves none of them in the findings, their occurrences or their history", async () => {
    const { h } = await seededRun();
    const list = await h.agent.get(`${BASE}/findings?pageSize=100`);
    expect(list.body.total).toBeGreaterThan(0);
    assertNoSecrets("findings list", list.text, MUST_BE_ABSENT);
    const [first] = list.body.items;
    assertNoSecrets("finding detail", (await h.agent.get(`${BASE}/findings/${first.id}`)).text, MUST_BE_ABSENT);
    assertNoSecrets("finding evidence", (await h.agent.get(`${BASE}/findings/${first.id}/occurrences/${first.occurrences[0].resultId}/evidence`)).text, MUST_BE_ABSENT);
  });

  it("leaves none of them in the rows kept after the session: runs, results, findings, scenarios and settings", async () => {
    const { h } = await seededRun();
    const db = getSharedConnection().db;
    for (const table of ["security_runs", "security_run_results", "security_findings", "security_scenarios", "security_scenario_versions", "security_settings"]) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      assertNoSecrets(`retained table ${table}`, JSON.stringify(rows, (_key, value) => (Buffer.isBuffer(value) ? value.toString("latin1") : value)), MUST_BE_ABSENT);
    }
    expect(h.ownerId.length).toBeGreaterThan(0);
  });

  it("stores the session's own credentials and evidence only encrypted", async () => {
    await seededRun();
    const db = getSharedConnection().db;
    const rows = [...db.prepare("SELECT value_encrypted FROM security_credentials").all(), ...db.prepare("SELECT evidence_encrypted FROM security_evidence").all()] as Array<Record<string, Buffer>>;
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) {
      const text = Object.values(row).map((value) => value.toString("latin1")).join("");
      assertNoSecrets("encrypted column", text, MUST_BE_ABSENT);
    }
  });

  it("leaves none of them in the logs", async () => {
    const { logged } = await seededRun();
    expect(logged.length).toBeGreaterThan(10);
    assertNoSecrets("log output", logged.join("\n"), [...MUST_BE_ABSENT, ...ALL_SECRETS]);
  });

  it("leaves none of them in the report, as JSON or as HTML", async () => {
    const { h } = await seededRun();
    for (const format of ["json", "html"]) {
      const report = await h.agent.get(`${BASE}/report?format=${format}`);
      expect(report.status).toBe(200);
      assertNoSecrets(`report ${format}`, report.text, [...MUST_BE_ABSENT, ...ALL_SECRETS]);
    }
    assertNoSecrets("overview", (await h.agent.get(`${BASE}/overview`)).text, MUST_BE_ABSENT);
    assertNoSecrets("retained data summary", (await h.agent.get(`${BASE}/data`)).text, MUST_BE_ABSENT);
  });

  it("leaves none of them in the Postman export of the approved scenarios (collection, environment, README)", async () => {
    const { h } = await seededRun();
    const exported = await h.agent.get(`${BASE}/export/postman`);
    expect(exported.status).toBe(200);
    expect(exported.body.summary.requestCount).toBeGreaterThan(0);
    assertNoSecrets("postman export", exported.text, [...MUST_BE_ABSENT, ...ALL_SECRETS]);
    for (const value of exported.body.environment.values as Array<{ type: string; value: string }>) {
      if (value.type === "secret") expect(value.value).toBe("");
    }
  });

  it("never returns a credential from the profile, credential or environment routes", async () => {
    const { h } = await seededRun();
    const texts = [
      (await h.agent.get(`${BASE}/profiles`)).text,
      (await h.agent.get(`${BASE}/profiles/${h.profileId}/credentials`)).text,
      (await h.agent.get(`${BASE}/environments`)).text,
      (await h.agent.post(`${BASE}/profiles/${h.profileId}/check`)).text,
    ].join("\n");
    assertNoSecrets("profile routes", texts, MUST_BE_ABSENT);
  });
});
