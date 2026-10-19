import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";

const FIXTURES = path.resolve(__dirname, "../../fixtures/securityLab");
const BASE = "/api/security-lab";

type Agent = ReturnType<typeof request.agent>;
interface GenerationReply {
  scope: unknown;
  created: number;
  kept: number;
  newVersions: number;
  rejected: unknown[];
}

async function agentWithSpec(app = createApp()): Promise<Agent> {
  const agent = request.agent(app);
  const upload = await agent.post("/api/test-generation-workflow").attach("file", readFileSync(path.join(FIXTURES, "sample-api.yaml")), "sample-api.yaml");
  expect(upload.status).toBe(200);
  return agent;
}

async function generated(app = createApp()): Promise<{ agent: Agent; reply: GenerationReply }> {
  const agent = await agentWithSpec(app);
  const res = await agent.post(`${BASE}/scenarios/generate`).send({ scope: { mode: "all" } });
  expect(res.status).toBe(200);
  return { agent, reply: res.body };
}

describe("GET /scope and POST /scenarios/generate", () => {
  it("answers 409 no_specification for both when nothing is loaded", async () => {
    resetStore();
    const agent = request.agent(createApp());
    for (const res of [await agent.get(`${BASE}/scope`), await agent.post(`${BASE}/scenarios/generate`).send({})]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("no_specification");
    }
  });

  it("reports every operation as the scope when the guided workflow made no selection", async () => {
    const agent = await agentWithSpec();
    const res = await agent.get(`${BASE}/scope`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: "all", selectedCount: 9, totalCount: 9 });
  });

  it("reports the guided selection as the default scope, and generates from it only", async () => {
    const agent = await agentWithSpec();
    await agent.post("/api/test-generation-workflow/api-review/continue").send({ selectedOperationKeys: ["GET /orders"] });
    expect((await agent.get(`${BASE}/scope`)).body).toEqual({ mode: "selection", selectedCount: 1, totalCount: 9 });

    const reply = await agent.post(`${BASE}/scenarios/generate`).send({});
    expect(reply.body.scope).toEqual({ mode: "selection", included: 1, excluded: 8 });
    const list = await agent.get(`${BASE}/scenarios?pageSize=100`);
    expect(new Set(list.body.items.map((item: { operationKey: string }) => item.operationKey))).toEqual(new Set(["GET /orders"]));
  });

  it("generates deterministic drafts for the whole specification and rejects none", async () => {
    const { reply } = await generated();
    expect(reply.scope).toEqual({ mode: "all", included: 9, excluded: 0 });
    expect(reply.created).toBeGreaterThan(0);
    expect(reply.kept).toBe(0);
    expect(reply.newVersions).toBe(0);
    expect(reply.rejected).toEqual([]);
  });

  it("is idempotent: generating again creates nothing and keeps every scenario", async () => {
    const { agent, reply } = await generated();
    const again = await agent.post(`${BASE}/scenarios/generate`).send({ scope: { mode: "all" } });
    expect(again.body).toMatchObject({ created: 0, kept: reply.created, newVersions: 0 });
  });

  it("limits generation to the categories asked for", async () => {
    const agent = await agentWithSpec();
    await agent.post(`${BASE}/scenarios/generate`).send({ scope: { mode: "all" }, categories: ["authentication"] });
    const list = await agent.get(`${BASE}/scenarios?pageSize=100`);
    expect(list.body.total).toBeGreaterThan(0);
    expect(Object.keys(list.body.counts.byCategory)).toEqual(["authentication"]);
  });

  it.each([
    [{ scope: { mode: "everything" } }, "invalid_request"],
    [{ scope: { mode: "custom" } }, "invalid_request"],
    [{ scope: { mode: "custom", operationKeys: [] } }, "invalid_request"],
    [{ categories: "authentication" }, "invalid_request"],
    [{ categories: ["no-such-category"] }, "category_not_generatable"],
  ])("refuses %j with %s", async (body, code) => {
    const agent = await agentWithSpec();
    const res = await agent.post(`${BASE}/scenarios/generate`).send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBe(code);
  });

  it("refuses to exceed the retention cap, naming the cap, and stores nothing", async () => {
    const limits = loadSecurityLabLimits();
    const app = createApp(undefined, { securityLab: { limits: { ...limits, retention: { ...limits.retention, maxScenarios: 5 } } } });
    const agent = await agentWithSpec(app);
    const res = await agent.post(`${BASE}/scenarios/generate`).send({ scope: { mode: "all" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("retention_limit_reached");
    expect(res.body.message).toMatch(/5/);
    expect((await agent.get(`${BASE}/scenarios`)).body.total).toBe(0);
  });
});

describe("GET /scenarios", () => {
  it("is readable with no specification loaded, flagging each scenario as such (FR-004)", async () => {
    const app = createApp();
    const { agent } = await generated(app);
    const owner = (await agent.get(`${BASE}/settings`)).headers["set-cookie"];
    expect(owner ?? []).toBeDefined();
    // Same browser, no workflow: the retained scenarios remain, none of them executable.
    resetStore();
    const list = await agent.get(`${BASE}/scenarios?pageSize=100`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);
    for (const item of list.body.items) {
      expect(item.flags).toMatchObject({ specificationNotLoaded: true, stale: false, orphaned: false, executable: false });
    }
  });

  it("filters by operation, category, severity, review state and free text, and counts the filtered set", async () => {
    const { agent } = await generated();
    const all = (await agent.get(`${BASE}/scenarios?pageSize=100`)).body;
    expect(all.total).toBeGreaterThan(10);
    expect(all.counts.byReviewState).toEqual({ draft: all.total });

    const byOperation = (await agent.get(`${BASE}/scenarios?operation=${encodeURIComponent("GET /orders")}&pageSize=100`)).body;
    expect(byOperation.items.length).toBeGreaterThan(0);
    expect(byOperation.items.every((item: { operationKey: string }) => item.operationKey === "GET /orders")).toBe(true);

    const category = Object.keys(all.counts.byCategory)[0];
    const byCategory = (await agent.get(`${BASE}/scenarios?category=${category}&pageSize=100`)).body;
    expect(byCategory.total).toBe(all.counts.byCategory[category]);

    const severity = Object.keys(all.counts.bySeverity)[0];
    const bySeverity = (await agent.get(`${BASE}/scenarios?severity=${severity}&pageSize=100`)).body;
    expect(bySeverity.total).toBe(all.counts.bySeverity[severity]);

    expect((await agent.get(`${BASE}/scenarios?reviewState=approved`)).body.total).toBe(0);
    expect((await agent.get(`${BASE}/scenarios?q=zzz-no-such-text`)).body.total).toBe(0);
  });

  it("pages, and never returns more than the page size", async () => {
    const { agent } = await generated();
    const first = (await agent.get(`${BASE}/scenarios?pageSize=10&page=1`)).body;
    const second = (await agent.get(`${BASE}/scenarios?pageSize=10&page=2`)).body;
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(10);
    expect(first.items[0].id).not.toBe(second.items[0].id);
    expect(first.total).toBe(second.total);
  });

  it.each([["severity=catastrophic"], ["reviewState=done"], ["executionStatus=maybe"], ["flag=weird"], ["page=0"], ["pageSize=101"], ["pageSize=abc"]])(
    "refuses ?%s with invalid_request",
    async (query) => {
      const res = await request.agent(createApp()).get(`${BASE}/scenarios?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    },
  );

  it("keeps each browser's scenarios apart", async () => {
    const app = createApp();
    await generated(app);
    const other = await request.agent(app).get(`${BASE}/scenarios`);
    expect(other.body.total).toBe(0);
  });
});

describe("GET /scenarios/ids and /scenarios/:id", () => {
  it("lists the exact id and version pairs a filter matches, for a batch to name", async () => {
    const { agent } = await generated();
    const total = (await agent.get(`${BASE}/scenarios`)).body.total;
    const ids = await agent.get(`${BASE}/scenarios/ids`);
    expect(ids.body.total).toBe(total);
    expect(ids.body.capped).toBe(false);
    expect(ids.body.items[0]).toEqual({ id: expect.stringMatching(/^ss-[0-9a-f]{16}$/), version: 1 });
  });

  it("returns the full detail with versions, and 404 for an unknown id", async () => {
    const { agent } = await generated();
    const { id } = (await agent.get(`${BASE}/scenarios?pageSize=1`)).body.items[0];
    const detail = await agent.get(`${BASE}/scenarios/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.scenario.id).toBe(id);
    expect(detail.body.content.operationKey).toBe(detail.body.scenario.operationKey);
    expect(detail.body.versions).toHaveLength(1);
    expect(detail.body.versions[0]).toMatchObject({ version: 1, author: "generator", materialChange: false });

    const missing = await agent.get(`${BASE}/scenarios/ss-0000000000000000`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("scenario_not_found");
  });
});

describe("POST /scenarios/review", () => {
  async function firstTwo(agent: Agent): Promise<Array<{ id: string; version: number }>> {
    const res = await agent.get(`${BASE}/scenarios/ids?severity=low`);
    const items = res.body.items.length >= 2 ? res.body.items : (await agent.get(`${BASE}/scenarios/ids`)).body.items;
    return items.slice(0, 2);
  }

  it("submits then approves the named scenarios, and changes nothing else", async () => {
    const { agent } = await generated();
    const [a, b] = await firstTwo(agent);
    const submit = await agent.post(`${BASE}/scenarios/review`).send({ action: "submit", items: [a, b] });
    expect(submit.status).toBe(200);
    expect(submit.body.refused).toEqual([]);
    expect(submit.body.applied.map((o: { id: string }) => o.id)).toEqual([a.id, b.id]);

    const approve = await agent.post(`${BASE}/scenarios/review`).send({ action: "approve", items: [a], destructiveConfirmations: [a.id] });
    expect(approve.body.applied).toHaveLength(1);
    const counts = (await agent.get(`${BASE}/scenarios?pageSize=1`)).body.counts.byReviewState;
    expect(counts).toMatchObject({ approved: 1, in_review: 1 });
  });

  it("answers 200 with applied and refused lists for a partial outcome", async () => {
    const { agent } = await generated();
    const [a] = await firstTwo(agent);
    const res = await agent.post(`${BASE}/scenarios/review`).send({
      action: "submit",
      items: [a, { id: "ss-ffffffffffffffff", version: 1 }, { ...a, version: 9 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied.map((o: { id: string }) => o.id)).toEqual([a.id]);
    expect(res.body.refused.map((o: { reasonCode: string }) => o.reasonCode)).toEqual(["scenario_not_found", "stale_version"]);
  });

  it("refuses submit and approve for scenarios when no specification is loaded, per item (not_executable_content)", async () => {
    const { agent } = await generated();
    const [a] = await firstTwo(agent);
    resetStore();
    const res = await agent.post(`${BASE}/scenarios/review`).send({ action: "submit", items: [a] });
    expect(res.status).toBe(200);
    expect(res.body.applied).toEqual([]);
    expect(res.body.refused[0]).toMatchObject({ id: a.id, reasonCode: "not_executable_content" });
    // Rejecting sends nothing, so it is still allowed.
    const reject = await agent.post(`${BASE}/scenarios/review`).send({ action: "reject", items: [a], reason: "spec gone" });
    expect(reject.body.applied).toHaveLength(1);
  });

  it.each([
    [{ action: "delete", items: [{ id: "ss-1", version: 1 }] }],
    [{ action: "submit" }],
    [{ action: "submit", items: [] }],
    [{ action: "submit", items: "all" }],
    [{ action: "submit", items: [{ id: "ss-1" }] }],
    [{ action: "submit", filter: { severity: "low" } }],
    [{ action: "reject", items: [{ id: "ss-1", version: 1 }], reason: 5 }],
    [{ action: "approve", items: [{ id: "ss-1", version: 1 }], destructiveConfirmations: "ss-1" }],
  ])("refuses %j as a whole with invalid_request, never expanding a filter", async (body) => {
    const res = await request.agent(createApp()).post(`${BASE}/scenarios/review`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

describe("PATCH /scenarios/:id", () => {
  async function oneScenario() {
    const { agent } = await generated();
    const { id } = (await agent.get(`${BASE}/scenarios?pageSize=1`)).body.items[0];
    return { agent, id };
  }

  it("applies a non-material edit as a new version and returns the refreshed detail", async () => {
    const { agent, id } = await oneScenario();
    const res = await agent.patch(`${BASE}/scenarios/${id}`).send({ expectedVersion: 1, changes: { title: "A clearer title" }, note: "Reworded" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scenarioId: id, version: 2, material: false, reviewState: "draft" });
    expect(res.body.scenario.scenario.title).toBe("A clearer title");
    expect(res.body.scenario.versions.map((v: { version: number; author: string }) => [v.version, v.author])).toEqual([[1, "generator"], [2, "user"]]);
  });

  it("answers 409 stale_version naming the current version", async () => {
    const { agent, id } = await oneScenario();
    await agent.patch(`${BASE}/scenarios/${id}`).send({ expectedVersion: 1, changes: { title: "Second" } });
    const res = await agent.patch(`${BASE}/scenarios/${id}`).send({ expectedVersion: 1, changes: { title: "Third" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("stale_version");
    expect(res.body.currentVersion).toBe(2);
  });

  it("answers 422 scenario_invalid with every violation for an unsafe edit, and stores nothing", async () => {
    const { agent, id } = await oneScenario();
    const res = await agent.patch(`${BASE}/scenarios/${id}`).send({ expectedVersion: 1, changes: { rationale: "Send it to http://evil.example" } });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("scenario_invalid");
    expect(res.body.violations.map((v: { code: string }) => v.code)).toContain("url_in_content");
    expect((await agent.get(`${BASE}/scenarios/${id}`)).body.versions).toHaveLength(1);
  });

  it("answers 409 no_specification for a material edit with nothing loaded", async () => {
    const { agent, id } = await oneScenario();
    resetStore();
    const res = await agent.patch(`${BASE}/scenarios/${id}`).send({ expectedVersion: 1, changes: { mutations: [{ kind: "auth.malformed" }, { kind: "auth.invalid-token" }] } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_specification");
  });

  it("answers 404 for an unknown scenario and 400 for a malformed body", async () => {
    const agent = await agentWithSpec();
    expect((await agent.patch(`${BASE}/scenarios/ss-0000000000000000`).send({ expectedVersion: 1, changes: { title: "x" } })).status).toBe(404);
    for (const body of [{ changes: { title: "x" } }, { expectedVersion: "1", changes: { title: "x" } }, { expectedVersion: 1 }, { expectedVersion: 1, changes: { title: "x" }, note: "n".repeat(501) }]) {
      const res = await agent.patch(`${BASE}/scenarios/ss-0000000000000000`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    }
  });
});
