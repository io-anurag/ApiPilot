import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { ALICE_EXPIRED_TOKEN, ALICE_KEY, ALICE_TOKEN, BOB_KEY, BOB_TOKEN } from "../../fixtures/securityLab/fixtureCredentials";
import { approve, generateAll, scenarioIds, startHarness, type Harness, type ScenarioRef } from "../../fixtures/securityLab/runHarness";
import { ALL_SECRETS, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

const BASE = "/api/security-lab";
const harnesses: Harness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
});

async function setup(approveSome = true) {
  const h = await startHarness();
  harnesses.push(h);
  await generateAll(h);
  const items = [
    ...(await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`)),
    ...(await scenarioIds(h, `operation=${encodeURIComponent("GET /orders/{orderId}")}&category=broken-object-level-authorization`)),
  ];
  if (approveSome) await approve(h, items);
  return { h, items };
}

const exportOf = (h: Harness, query = "") => h.agent.get(`${BASE}/export/postman${query}`);

describe("GET /export/postman", () => {
  it("answers 409 no_specification when none is loaded", async () => {
    const { h } = await setup();
    resetStore();
    const res = await exportOf(h);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_specification");
  });

  it("answers 409 no_approved_scenarios when nothing is approved, and a draft is never exported", async () => {
    const { h } = await setup(false);
    const res = await exportOf(h);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "no_approved_scenarios", excluded: [] });
  });

  it("exports exactly the approved scenarios at their approved versions, in the existing result shape", async () => {
    const { h, items } = await setup();
    const res = await exportOf(h);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(res.body).sort()).toEqual(["collection", "credentialProducers", "environment", "excluded", "limitations", "readme", "summary", "validation"]);
    expect(res.body.validation.valid).toBe(true);
    const exportedIds = res.body.collection.item.flatMap((folder: { item: Array<{ provenance: { scenarioId: string } }> }) => folder.item.map((entry) => entry.provenance.scenarioId));
    expect(exportedIds.sort()).toEqual(items.map((item: ScenarioRef) => item.id).sort());
    expect(res.body.excluded).toEqual([]);
    expect(res.body.summary.requestCount).toBe(items.length);
  });

  it("leaves out a scenario that is not approved, and one that is only in review", async () => {
    const { h, items } = await setup();
    const [extra] = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authorization`);
    const drafts = (await scenarioIds(h, "reviewState=draft")).slice(0, 1);
    await h.agent.post(`${BASE}/scenarios/review`).send({ action: "submit", items: [extra ?? drafts[0]] });
    const res = await exportOf(h);
    const ids = res.body.collection.item.flatMap((folder: { item: Array<{ provenance: { scenarioId: string } }> }) => folder.item.map((entry) => entry.provenance.scenarioId));
    expect(ids).toHaveLength(items.length);
    expect(ids).not.toContain((extra ?? drafts[0]).id);
  });

  it("is identical on a second export (SC-004)", async () => {
    const { h } = await setup();
    const first = (await exportOf(h)).body;
    const second = (await exportOf(h)).body;
    expect(second).toEqual(first);
  });

  it("puts a supplied base URL in the environment and names the collection as asked, and refuses a bad URL", async () => {
    const { h } = await setup();
    const res = await exportOf(h, `?baseUrl=${encodeURIComponent("https://staging.example.test/")}&collectionName=Nightly`);
    expect(res.body.collection.info.name).toBe("Nightly");
    expect(res.body.environment.values.find((value: { key: string }) => value.key === "baseUrl").value).toBe("https://staging.example.test");
    for (const bad of ["not a url", "ftp://x.test", "https://user:pw@x.test"]) {
      const refused = await exportOf(h, `?baseUrl=${encodeURIComponent(bad)}`);
      expect(refused.status, bad).toBe(400);
      expect(refused.body.error).toBe("invalid_request");
    }
    expect((await exportOf(h, `?collectionName=${"x".repeat(101)}`)).status).toBe(400);
  });

  it("excludes an approved scenario whose operation is no longer in the specification, and says so", async () => {
    const { h } = await setup();
    resetStore();
    const upload = await h.agent.post("/api/test-generation-workflow").attach("file", readFileSync(path.join(__dirname, "../../fixtures/securityLab/no-security.yaml")), "no-security.yaml");
    expect(upload.status).toBe(200);
    const res = await exportOf(h);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_approved_scenarios");
    expect(res.body.excluded.length).toBeGreaterThan(0);
    expect(res.body.excluded.every((entry: { reason: string }) => entry.reason === "orphaned")).toBe(true);
  });

  it("answers 422 export_failed with the generator's own code when an approved version no longer matches what was approved", async () => {
    const { h, items } = await setup();
    // A tampered stored content, as a bad write would leave it: the stored hash and the approval still agree with each other.
    const db = getSharedConnection().db;
    const row = db.prepare("SELECT content FROM security_scenario_versions WHERE owner_id = ? AND scenario_id = ?").get(h.ownerId, items[0].id) as { content: string };
    const tampered = { ...JSON.parse(row.content), title: "Tampered after approval", mutations: [{ kind: "auth.malformed" }] };
    db.prepare("UPDATE security_scenario_versions SET content = ? WHERE owner_id = ? AND scenario_id = ?").run(JSON.stringify(tampered), h.ownerId, items[0].id);
    const res = await exportOf(h);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "export_failed", failureCode: "unapproved_version" });
    expect(res.body.message).toContain(items[0].id);
  });

  it("is keyed to the browser: another browser has nothing approved to export", async () => {
    const { h } = await setup();
    const other = await import("supertest").then((module) => module.default.agent(h.app));
    expect((await other.get(`${BASE}/export/postman`)).status).toBe(409);
  });

  it("contains no credential, whatever the profile holds", async () => {
    const { h } = await setup();
    const text = JSON.stringify((await exportOf(h)).body);
    assertNoSecrets("security export", text, [...ALL_SECRETS, ALICE_TOKEN, BOB_TOKEN, ALICE_KEY, BOB_KEY, ALICE_EXPIRED_TOKEN]);
    expect(text).not.toContain(h.target.origin);
  });
});
