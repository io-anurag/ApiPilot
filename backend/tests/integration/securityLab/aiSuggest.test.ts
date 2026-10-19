import { afterEach, describe, expect, it } from "vitest";
import type { AIErrorCategory, AIProvider, InferenceRequest, InferenceResponse, ReadinessState } from "@apipilot/shared-domain";
import { getSecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import { SECURITY_SUGGESTION_RESPONSE_VERSION } from "../../../src/securityLab/ai/suggestionPrompt";
import { ALICE_TOKEN } from "../../fixtures/securityLab/fixtureCredentials";
import { generateAll, preview, startHarness, type Harness } from "../../fixtures/securityLab/runHarness";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";

const BASE = "/api/security-lab";
const harnesses: Harness[] = [];

afterEach(async () => {
  await settleActiveRuns();
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
});

class StubProvider implements AIProvider {
  readonly mode = "mock" as const;
  readonly requests: InferenceRequest[] = [];
  constructor(
    private readonly reply: () => Partial<InferenceResponse> & { content?: string },
    private readonly readiness: Partial<ReadinessState> = {},
  ) {}

  getReadiness(): ReadinessState {
    return { state: "ready", acceleratorRequested: false, acceleratorActive: false, updatedAt: "2026-01-01T00:00:00.000Z", ...this.readiness };
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    this.requests.push(request);
    return { contractVersion: 1, requestId: request.requestId, status: "success", modelId: "stub-model", provider: "mock", durationMs: 1, ...this.reply() };
  }

  async getInputBudget(): Promise<number | undefined> {
    return undefined;
  }
}

// An idea the fixed generator does not produce: omitting credentials is generated under "authentication", never under "authorization".
const valid = () => ({
  operationKey: "DELETE /orders/{orderId}",
  categoryId: "authorization",
  title: "DELETE needs more than a caller",
  objective: "Check that deleting an order without any credential is refused.",
  rationale: "Deleting is destructive, so an unauthenticated caller must never reach it.",
  impact: "Anyone could delete orders.",
  mutations: [{ kind: "auth.omit" }],
  expected: { kind: "rejected", ruleId: "SL-REJECT-NOT-SUCCESS" },
  conditions: [{ kind: "status.not-success" }],
  confidence: 0.8,
  assumptions: ["The operation is meant to need credentials."],
});

const answer = (suggestions: unknown[]) => JSON.stringify({ responseVersion: SECURITY_SUGGESTION_RESPONSE_VERSION, suggestions });

async function setup(provider: AIProvider, options: { generate?: boolean; withSpecification?: boolean } = {}) {
  const h = await startHarness({ securityLab: { getAIProvider: () => provider }, withSpecification: options.withSpecification });
  harnesses.push(h);
  if (options.generate !== false && options.withSpecification !== false) await generateAll(h);
  return h;
}

const suggest = (h: Harness, body: unknown = {}) => h.agent.post(`${BASE}/scenarios/suggest`).send(body as object);

describe("POST /scenarios/suggest with one valid, one malformed, one URL-bearing and one unsupported suggestion", () => {
  const four = () => answer([valid(), { operationKey: "GET /orders", title: "no other fields" }, { ...valid(), mutations: [{ kind: "method.probe", method: "OPTIONS" }], rationale: "Send it to http://evil.example/steal." }, { ...valid(), mutations: [{ kind: "shell.exec", command: "rm -rf /" }] }]);

  it("accepts only the valid one, as an AI draft, and names why each other was refused", async () => {
    const h = await setup(new StubProvider(() => ({ content: four() })));
    const before = (await h.agent.get(`${BASE}/scenarios?pageSize=1`)).body.total;
    const res = await suggest(h);
    expect(res.status).toBe(200);
    expect(res.body.model).toBe("stub-model");
    expect(res.body.accepted).toEqual([expect.objectContaining({ operationKey: "DELETE /orders/{orderId}", categoryId: "authorization", title: "DELETE needs more than a caller", id: expect.stringMatching(/^ss-[0-9a-f]{16}$/) })]);
    expect(res.body.rejected.map((entry: { index: number }) => entry.index)).toEqual([1, 2, 3]);
    expect(res.body.rejected[0].reason).toMatch(/must be a/);
    expect(res.body.rejected[1].violations.map((v: { code: string }) => v.code)).toContain("url_in_content");
    expect(res.body.rejected[2].violations.map((v: { code: string }) => v.code)).toContain("schema_violation");
    expect((await h.agent.get(`${BASE}/scenarios?pageSize=1`)).body.total).toBe(before + 1);
  });

  it("stores it as a draft marked AI, with the model, confidence and assumptions in its provenance, never approved", async () => {
    const h = await setup(new StubProvider(() => ({ content: four() })));
    const { accepted } = (await suggest(h)).body;
    const detail = (await h.agent.get(`${BASE}/scenarios/${accepted[0].id}`)).body;
    expect(detail.scenario).toMatchObject({ origin: "ai", reviewState: "draft", executionStatus: "not_run", currentVersion: 1 });
    expect(detail.scenario.flags.executable).toBe(false);
    expect(detail.versions).toEqual([expect.objectContaining({ version: 1, author: "ai", materialChange: false })]);
    expect(detail.versions[0].approval).toBeUndefined();
    expect(detail.content.provenance).toMatchObject({ ruleId: "ai.suggestion", aiModel: "stub-model", aiConfidence: 0.8, aiAssumptions: ["The operation is meant to need credentials."] });
    expect(detail.content.limitations[0]).toMatch(/Review it before approving/);
    expect((await h.agent.get(`${BASE}/scenarios?origin=ai`)).status).toBe(200);
    expect(getSecurityScenarioRepository().getScenario(h.ownerId, accepted[0].id)?.origin).toBe("ai");
  });

  it("cannot run until a person approves it: a run plan refuses it", async () => {
    const h = await setup(new StubProvider(() => ({ content: four() })));
    const { accepted } = (await suggest(h)).body;
    const plan = await preview(h, [{ id: accepted[0].id, version: 1 }]);
    // It is also destructive (a DELETE), which the profile does not permit; the point is that it is not approved.
    expect(plan.body.problems.map((problem: { code: string }) => problem.code)).toContain("not_approved");
    expect(h.target.requests).toEqual([]);
  });

  it("does not store the same scenario twice, nor replace one that exists", async () => {
    const h = await setup(new StubProvider(() => ({ content: answer([valid(), valid()]) })));
    const first = (await suggest(h)).body;
    expect(first.accepted).toHaveLength(1);
    expect(first.rejected).toEqual([expect.objectContaining({ index: 1, reason: expect.stringMatching(/^duplicate/) })]);
    const second = (await suggest(h)).body;
    expect(second.accepted).toEqual([]);
    expect(second.rejected[0].reason).toMatch(/already exists as ss-/);
    expect((await h.agent.get(`${BASE}/scenarios?pageSize=1`)).body.total).toBeGreaterThan(0);
  });

  it("keeps the suggested scenario subject to the same review rules, so an edit follows the same path", async () => {
    const h = await setup(new StubProvider(() => ({ content: four() })));
    const { accepted } = (await suggest(h)).body;
    const submit = await h.agent.post(`${BASE}/scenarios/review`).send({ action: "submit", items: [{ id: accepted[0].id, version: 1 }] });
    expect(submit.body.applied).toHaveLength(1);
    const edit = await h.agent.patch(`${BASE}/scenarios/${accepted[0].id}`).send({ expectedVersion: 1, changes: { rationale: "Send it to http://evil.example/steal" } });
    expect(edit.status).toBe(422);
  });
});

describe("what the model is told", () => {
  it("is the shape of operations through the AIProvider only: no credential, URL, response or target address", async () => {
    const provider = new StubProvider(() => ({ content: answer([]) }));
    const h = await setup(provider);
    expect((await suggest(h)).body).toMatchObject({ accepted: [], rejected: [] });
    expect(provider.requests).toHaveLength(1);
    const sent = provider.requests[0];
    expect(sent.expectedOutputFormat).toBe("json");
    expect(sent.input).not.toContain(ALICE_TOKEN);
    expect(sent.input).not.toContain(h.target.origin);
    expect(sent.input).not.toMatch(/https?:\/\//);
    expect(sent.input).toContain("GET /orders");
  });

  it("is limited to the operations asked for, and refuses one the specification does not have", async () => {
    const provider = new StubProvider(() => ({ content: answer([]) }));
    const h = await setup(provider);
    await suggest(h, { operationKeys: ["POST /orders"], categories: ["input-validation"] });
    const prompt = JSON.parse(provider.requests[0].input) as { operations: Array<{ operationKey: string }>; categories: string[] };
    expect(prompt.operations.map((operation) => operation.operationKey)).toEqual(["POST /orders"]);
    expect(prompt.categories).toEqual(["input-validation"]);
    const unknown = await suggest(h, { operationKeys: ["GET /nowhere"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("invalid_request");
  });

  it.each([
    [{ operationKeys: [] }],
    [{ operationKeys: "GET /orders" }],
    [{ categories: ["api-inventory"] }],
    [{ categories: ["nope"] }],
  ])("refuses the request %j", async (body) => {
    const h = await setup(new StubProvider(() => ({ content: answer([]) })));
    const res = await suggest(h, body);
    expect(res.status).toBe(400);
    expect(["invalid_request", "category_not_generatable"]).toContain(res.body.error);
  });
});

describe("with no usable AI, only suggestions are affected (SC-015)", () => {
  const unusable: Array<[string, () => AIProvider]> = [
    ["a provider that is unavailable", () => new StubProvider(() => ({}), { state: "unavailable", reason: "The model files could not be found." })],
    ["a provider that is not ready", () => new StubProvider(() => ({ status: "error", errorCategory: "NOT_READY" as AIErrorCategory, errorMessage: "internal detail: /secret/path" }))],
    ["a provider that times out", () => new StubProvider(() => ({ status: "error", errorCategory: "TIMEOUT" as AIErrorCategory }))],
    ["a provider that fails to load", () => new StubProvider(() => ({ status: "error", errorCategory: "LOAD_FAILED" as AIErrorCategory }))],
    ["an answer that is not JSON", () => new StubProvider(() => ({ content: "I am sorry, I cannot." }))],
    ["an answer in the wrong version", () => new StubProvider(() => ({ content: JSON.stringify({ responseVersion: 9, suggestions: [] }) }))],
  ];

  it.each(unusable)("answers 503 ai_unavailable with the reason for %s, and stores nothing", async (_name, make) => {
    const h = await setup(make());
    const before = (await h.agent.get(`${BASE}/scenarios?pageSize=1`)).body.total;
    const res = await suggest(h);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ai_unavailable");
    expect(res.body.message.length).toBeGreaterThan(20);
    expect(JSON.stringify(res.body)).not.toContain("/secret/path");
    expect((await h.agent.get(`${BASE}/scenarios?pageSize=1`)).body.total).toBe(before);
  });

  it("names the readiness reason when the provider says why", async () => {
    const h = await setup(new StubProvider(() => ({}), { state: "unavailable", reason: "The model files could not be found." }));
    const res = await suggest(h);
    expect(res.body.message).toContain("The model files could not be found.");
    expect(res.body.readiness).toEqual({ state: "unavailable", reason: "The model files could not be found." });
  });

  it("leaves every other capability working: analysis, generation, review, profiles, overview, reports and export", async () => {
    const h = await setup(new StubProvider(() => ({}), { state: "unavailable", reason: "no model" }));
    expect((await suggest(h)).status).toBe(503);
    const ok = async (path: string) => expect((await h.agent.get(`${BASE}${path}`)).status, path).toBe(200);
    for (const path of ["/categories", "/analysis", "/settings", "/scope", "/scenarios", "/scenarios/ids", "/profiles", "/environments", "/overview", "/data", "/findings", "/runs"]) await ok(path);
    expect((await h.agent.post(`${BASE}/scenarios/generate`).send({ scope: { mode: "all" } })).status).toBe(200);
    const [first] = (await h.agent.get(`${BASE}/scenarios/ids`)).body.items;
    expect((await h.agent.post(`${BASE}/scenarios/review`).send({ action: "submit", items: [first] })).body.applied).toHaveLength(1);
    expect((await h.agent.get(`${BASE}/report`)).status).toBe(200);
    expect((await h.agent.get(`${BASE}/export/postman`)).status).toBe(409); // nothing approved yet, which is not an AI matter
  });

  it("answers 409 no_specification before it ever asks the provider, when no specification is loaded", async () => {
    const provider = new StubProvider(() => ({ content: answer([valid()]) }));
    const h = await setup(provider);
    resetStore();
    const res = await suggest(h);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_specification");
    expect(provider.requests).toEqual([]);
  });
});
