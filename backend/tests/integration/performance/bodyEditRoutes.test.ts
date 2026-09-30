import { beforeEach, describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { resetQuickTestsForTest } from "../../../src/performance/quick/quickTestStore";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { PERFORMANCE_BASE, generateReadyScript, performanceAgent, readyProbe } from "../../fixtures/performance/agent";
import { SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { QUICK_BASE, quickAgent, quickSteps, uploadQuick } from "../../fixtures/performance/quickAgent";
import { BODY_EDITS_SPECIFICATION_FILENAME, bodyEditsSpecificationBuffer } from "../../fixtures/performance/specification";

/** AP-033 contracts/body-edits-api.md (specs/033-edit-step-request-body tasks T015, T018). */

async function bodyEditsAgent() {
  const { agent } = await quickAgent({ runner: createFakeRunner({ lines: [] }) });
  const created = await uploadQuick(agent, { buffer: bodyEditsSpecificationBuffer(), filename: BODY_EDITS_SPECIFICATION_FILENAME });
  expect(created.status).toBe(200);
  const steps = quickSteps(created.body.quickTest.plan);
  const stepOf = (operationKey: string) => steps.find((step) => step.operationKey === operationKey)!;
  return { agent, stepOf };
}

describe("the body a step sends, through the quick path (US1)", () => {
  beforeEach(() => resetStore());

  it("states each body status in the step preview (FR-001)", async () => {
    const { agent, stepOf } = await bodyEditsAgent();
    const statusOf = async (operationKey: string) =>
      (await agent.get(`${QUICK_BASE}/plan/steps/${stepOf(operationKey).id}/request`)).body.request.bodyStatus;
    expect(await statusOf("GET /errors/conflict")).toBe("not-documented");
    expect(await statusOf("POST /orders")).toBe("sent");
    expect(await statusOf("POST /notes")).toBe("sent");
    expect(await statusOf("POST /uploads")).toBe("unsupported-content-type");
  });
});

interface StepBody {
  id: string;
  operationKey: string;
  bodyEdited?: true;
}

function stepsOf(plan: { journeys: { steps: StepBody[] }[] }): StepBody[] {
  return plan.journeys.flatMap((journey) => journey.steps);
}

describe("PUT /plan bodyEdits (US2, contracts/body-edits-api.md)", () => {
  beforeEach(() => resetStore());

  it("saves an edit on the quick path, marks the step, shows it in the preview and makes the script out of date", async () => {
    const { agent, stepOf } = await bodyEditsAgent();
    const orders = stepOf("POST /orders");
    const status = await agent.post(`${QUICK_BASE}/script`);
    expect(status.status).toBe(200);

    const saved = await agent.put(`${QUICK_BASE}/plan`).send({ bodyEdits: { [orders.id]: { kind: "json", text: '{"quantity": 0, "status": "unknown"}' } } });
    expect(saved.status).toBe(200);
    expect(saved.body.plan.bodyEdits).toHaveLength(1);
    expect(stepsOf(saved.body.plan).find((step) => step.id === orders.id)?.bodyEdited).toBe(true);
    expect(saved.body.script.outOfDate).toBe(true);

    const preview = (await agent.get(`${QUICK_BASE}/plan/steps/${orders.id}/request`)).body.request;
    expect(preview.bodyEdit.edited).toBe(true);
    expect(JSON.parse(preview.body.text)).toMatchObject({ quantity: 0, status: "unknown" });
    expect(preview.bodyEdit.mismatches.map((mismatch: { fieldPath: string }) => mismatch.fieldPath)).toEqual([
      "customerEmail",
      "quantity",
      "shipping",
      "status",
    ]);

    // FR-005: mismatches never block the script.
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
  });

  it("returns each refusal with its extra fields and leaves the plan unchanged", async () => {
    const { agent, stepOf } = await bodyEditsAgent();
    const before = (await agent.get(`${QUICK_BASE}/plan`)).body.plan;
    const cases: [Record<string, unknown>, number, Record<string, unknown>][] = [
      [{ bodyEdits: [] }, 400, { error: "invalid_request" }],
      [{ bodyEdits: { s_nope: { kind: "json", text: "{}" } } }, 400, { error: "invalid_body_edit", stepId: "s_nope" }],
      [{ bodyEdits: { [stepOf("GET /errors/conflict").id]: { kind: "json", text: "{}" } } }, 400, { error: "body_not_accepted" }],
      [{ bodyEdits: { [stepOf("POST /notes").id]: { kind: "text", text: "x".repeat(65_537) } } }, 400, { error: "body_too_large", limitBytes: 65_536 }],
      [{ bodyEdits: { [stepOf("POST /orders").id]: { kind: "json", text: '{"quantity": }' } } }, 400, { error: "invalid_body", line: 1, column: 14 }],
    ];
    for (const [body, status, expected] of cases) {
      const response = await agent.put(`${QUICK_BASE}/plan`).send(body);
      expect(response.status).toBe(status);
      expect(response.body).toMatchObject(expected);
    }
    expect((await agent.get(`${QUICK_BASE}/plan`)).body.plan).toEqual(before);
  });

  it("saves on the guided path without changing the approved test model or the Postman collection (FR-016)", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) });
    await generateReadyScript(agent);
    const workflowBefore = (await agent.get("/api/test-generation-workflow")).body.workflow;
    expect(workflowBefore.approvedTestModel.scenarios.length).toBeGreaterThan(0);
    expect(workflowBefore.postmanArtifact.collection.item.length).toBeGreaterThan(0);
    const plan = (await agent.get(`${PERFORMANCE_BASE}/plan`)).body.plan;
    const orders = stepsOf(plan).find((step) => step.operationKey === "POST /orders")!;

    const saved = await agent.put(`${PERFORMANCE_BASE}/plan`).send({ bodyEdits: { [orders.id]: { kind: "json", text: '{"customerEmail": "buyer@example.com", "quantity": 4}' } } });
    expect(saved.status).toBe(200);
    expect(saved.body.script.outOfDate).toBe(true);

    const workflowAfter = (await agent.get("/api/test-generation-workflow")).body.workflow;
    expect(workflowAfter.approvedTestModel).toEqual(workflowBefore.approvedTestModel);
    expect(workflowAfter.postmanArtifact).toEqual(workflowBefore.postmanArtifact);
  });
});

describe("runs of a plan with an edited body (FR-014)", () => {
  beforeEach(() => {
    resetStore();
    resetQuickTestsForTest();
  });

  it("records which steps were edited, and no body content, in the stored run, the run response and the report", async () => {
    const BODY_MARKER = "EDITED-BODY-MARKER-9a7d";
    const { agent } = await quickAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    const created = await uploadQuick(agent, { buffer: bodyEditsSpecificationBuffer(), filename: BODY_EDITS_SPECIFICATION_FILENAME });
    const orders = quickSteps(created.body.quickTest.plan).find((step) => step.operationKey === "POST /orders")!;
    const saved = await agent
      .put(`${QUICK_BASE}/plan`)
      .send({ bodyEdits: { [orders.id]: { kind: "json", text: JSON.stringify({ quantity: 2, customerEmail: "a@example.com", shipping: { city: BODY_MARKER } }) } } });
    expect(saved.status).toBe(200);
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const environment = await agent
      .post("/api/test-generation-workflow/environments")
      .send({ name: "quick-local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: { profileId: "p-1" } });
    const started = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId: environment.body.environment.id });
    expect(started.status).toBe(200);
    const runId = started.body.run.id;

    let run = started.body.run;
    for (let attempt = 0; attempt < 300 && run.status === "in-progress"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      run = (await agent.get(`${QUICK_BASE}/runs/${runId}`)).body.run;
    }
    expect(run.planSnapshot.bodyEdits).toEqual([]);
    expect(stepsOf(run.planSnapshot).find((step) => step.id === orders.id)?.bodyEdited).toBe(true);
    expect(JSON.stringify(run)).not.toContain(BODY_MARKER);

    const stored = getSharedConnection().db.prepare("SELECT * FROM performance_runs WHERE id = ?").get(runId);
    expect(JSON.stringify(stored)).not.toContain(BODY_MARKER);

    const report = await agent.get(`${QUICK_BASE}/runs/${runId}/report`);
    expect(report.status).toBe(200);
    expect(report.text).toContain("Body edited by you");
    expect(report.text).not.toContain(BODY_MARKER);
  });
});

describe("no secret reaches any output of a plan with body edits (US3, SC-003; tasks T035)", () => {
  beforeEach(() => {
    resetStore();
    resetQuickTestsForTest();
  });

  it("keeps a secret referenced from an edited body out of the preview, plan, script, template, run, stored row and report", async () => {
    const { agent } = await quickAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    const created = await uploadQuick(agent, { buffer: bodyEditsSpecificationBuffer(), filename: BODY_EDITS_SPECIFICATION_FILENAME });
    const accounts = quickSteps(created.body.quickTest.plan).find((step) => step.operationKey === "POST /accounts")!;
    const saved = await agent.put(`${QUICK_BASE}/plan`).send({ bodyEdits: { [accounts.id]: { kind: "json", text: '{"name": "load", "pin": "{{accountPin}}"}' } } });
    expect(saved.status).toBe(200);
    expect(saved.body.plan.userSuppliedValues.find((value: { name: string }) => value.name === "accountPin")).toMatchObject({ source: "body-reference", secret: true });
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);
    const environment = await agent
      .post("/api/test-generation-workflow/environments")
      .send({ name: "quick-local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: { accountPin: SEEDED_CLIENT_SECRET, profileId: "p-1" } });
    const environmentId = environment.body.environment.id;

    const outputs: unknown[] = [
      saved.body,
      (await agent.get(`${QUICK_BASE}/plan/steps/${accounts.id}/request`)).body,
      (await agent.get(`${QUICK_BASE}/plan/values?environmentId=${environmentId}`)).body,
      (await agent.get(`${QUICK_BASE}/script/download?file=script`)).text,
      (await agent.get(`${QUICK_BASE}/script/download?file=environment-template`)).text,
    ];
    const started = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId });
    expect(started.status).toBe(200);
    let run = started.body.run;
    for (let attempt = 0; attempt < 300 && run.status === "in-progress"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      run = (await agent.get(`${QUICK_BASE}/runs/${run.id}`)).body.run;
    }
    outputs.push(run, (await agent.get(`${QUICK_BASE}/runs/${run.id}/report`)).text);
    outputs.push(getSharedConnection().db.prepare("SELECT * FROM performance_runs WHERE id = ?").get(run.id));

    for (const output of outputs) expect(typeof output === "string" ? output : JSON.stringify(output)).not.toContain(SEEDED_CLIENT_SECRET);
  });
});
