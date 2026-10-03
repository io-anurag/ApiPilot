import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChainPlan, ChainRun } from "@apipilot/shared-domain";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { chainAgent, CHAIN_BASE, createEnvironment, newPlan, savePlanContent } from "../../fixtures/chain/chainAgent";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T079; US6, FR-041 to FR-047). */

const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "chain");
const CUSTOMERS = readFileSync(path.join(FIXTURES, "customers.csv"));

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function upload(agent: Awaited<ReturnType<typeof chainAgent>>["agent"], planId: string, bytes: Buffer, name = "customers", mode = "row-per-iteration") {
  return agent.post(`${CHAIN_BASE}/${planId}/data-sets`).field("name", name).field("mode", mode).attach("file", bytes, "customers.csv");
}

describe("request-chain plan routes: data sets", () => {
  it("stores a CSV as a data set with its columns and row count, and lists it on the plan", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const added = await upload(agent, plan.id, CUSTOMERS);
    expect(added.status).toBe(201);
    expect(added.body.dataSet).toMatchObject({ name: "customers", mode: "row-per-iteration", rowCount: 50, columns: expect.arrayContaining([{ name: "password", secret: false }]) });
    expect(added.body.dataSet.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan.dataSets).toHaveLength(1);
    expect(JSON.stringify(added.body)).not.toContain("fixture-secret-01");
  });

  it.each([
    ["bad-short-row.csv", { reason: "field-count", line: 7, expected: 6, found: 5 }],
    ["bad-not-utf8.csv", { reason: "not-utf8", line: 2 }],
    ["bad-column-name.csv", { reason: "invalid-column-name", line: 1, column: "first name" }],
  ])("refuses %s with the reason and line, and stores nothing", async (file, refusal) => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const refused = await upload(agent, plan.id, readFileSync(path.join(FIXTURES, file)));
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: "data_set_invalid", ...refusal });
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan.dataSets).toEqual([]);
  });

  it("refuses a file over 5 MiB, a sixth data set, and a column another data set has", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    expect((await upload(agent, plan.id, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61))).status).toBe(413);
    expect((await upload(agent, plan.id, CUSTOMERS)).status).toBe(201);
    const clash = await upload(agent, plan.id, Buffer.from("email\nx@example.test\n"), "other");
    expect(clash.body).toMatchObject({ error: "data_set_invalid", reason: "column-in-other-data-set", column: "email", dataSetName: "customers" });
    for (let index = 0; index < 4; index += 1) expect((await upload(agent, plan.id, Buffer.from(`c${index}\n1\n`), `set ${index}`)).status).toBe(201);
    expect((await upload(agent, plan.id, Buffer.from("c9\n1\n"), "sixth")).body.error).toBe("data_set_limit_exceeded");
  });

  it("marks a column secret, hides it in the preview, keeps it secret on a file replace, and removes the data set", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const added = (await upload(agent, plan.id, CUSTOMERS)).body.dataSet;
    const columns = added.columns.map((column: { name: string }) => ({ name: column.name, secret: column.name === "password" }));
    const updated = await agent.put(`${CHAIN_BASE}/${plan.id}/data-sets/${added.id}`).send({ name: "Customers", mode: "row-per-virtual-user", columns });
    expect(updated.status).toBe(200);
    expect(updated.body.dataSet).toMatchObject({ name: "Customers", mode: "row-per-virtual-user" });
    const preview = await agent.get(`${CHAIN_BASE}/${plan.id}/data-sets/${added.id}/preview`);
    expect(preview.body.rows).toHaveLength(5);
    expect(preview.body.rows[0]).toEqual(["tenant-1", "Ada", "Lovelace", "ada.lovelace1@example.test", "user01", null]);
    expect(JSON.stringify(preview.body)).not.toContain("fixture-secret");

    const replaced = await agent.put(`${CHAIN_BASE}/${plan.id}/data-sets/${added.id}/file`).attach("file", Buffer.from("username,password\nu,p\n"), "logins.csv");
    expect(replaced.body.dataSet).toMatchObject({ rowCount: 1, columns: [{ name: "username", secret: false }, { name: "password", secret: true }] });
    expect(replaced.body.dataSet.sha256).not.toBe(added.sha256);

    const removed = await agent.delete(`${CHAIN_BASE}/${plan.id}/data-sets/${added.id}`);
    expect(removed.body.plan.dataSets).toEqual([]);
  });

  it("writes the run's copy into the run directory after the integrity check, removes it when the run ends, and marks the download", async () => {
    const runner = createFakeRunner({ lines: [], holdUntilCancelled: true });
    const { agent } = await chainAgent({ runner, probe: readyProbe() });
    const plan = await newPlan(agent);
    const environmentId = await createEnvironment(agent, { client_id: "id-1", client_secret: "s" });
    await upload(agent, plan.id, CUSTOMERS);
    const content = customerLifecyclePlan({ targetEnvironmentId: environmentId });
    content.chains[0].steps[1] = { ...content.chains[0].steps[1], body: { kind: "raw", contentType: "application/json", text: '{"name":"{{first_name}}"}' } };
    const current = (await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan as ChainPlan;
    expect((await savePlanContent(agent, current, content)).status).toBe(200);
    expect((await agent.post(`${CHAIN_BASE}/${plan.id}/script`)).status).toBe(200);
    const download = await agent.get(`${CHAIN_BASE}/${plan.id}/script/download?file=script`);
    expect(download.headers["x-apipilot-note"]).toBe("data-sets-not-included");
    expect(download.text).toContain('open("./apipilot-data-0.json")');

    const run = (await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId })).body.run as ChainRun;
    expect(run.snapshot.dataSets).toEqual([expect.objectContaining({ name: "customers", rowCount: 50, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(JSON.stringify(run.snapshot)).not.toContain("fixture-secret");
    await waitFor(async () => runner.starts.length, (count) => count > 0);
    const copy = path.join(runner.starts[0].runDir, "apipilot-data-0.json");
    expect(existsSync(copy)).toBe(true);
    expect(JSON.parse(readFileSync(copy, "utf-8"))[49][5]).toBe("fixture-secret-50");
    await agent.post(`${CHAIN_BASE}/runs/${run.id}/cancel`);
    await waitFor(async () => (await agent.get(`${CHAIN_BASE}/runs/${run.id}`)).body.run.status as string, (status) => status !== "in-progress");
    expect(existsSync(runner.starts[0].runDir)).toBe(false);
  });
});
