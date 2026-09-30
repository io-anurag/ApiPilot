import { beforeEach, describe, expect, it } from "vitest";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { QUICK_BASE, quickAgent, quickSteps, uploadQuick } from "../../fixtures/performance/quickAgent";
import { PARAMETER_EDITS_SPECIFICATION_FILENAME, parameterEditsSpecificationBuffer } from "../../fixtures/performance/specification";

/** AP-033 FR-020 to FR-022 (amended 2026-09-30): `PUT /plan {parameterEdits}` on the quick path. */

async function parameterEditsAgent() {
  const { agent } = await quickAgent({ runner: createFakeRunner({ lines: [] }) });
  const created = await uploadQuick(agent, { buffer: parameterEditsSpecificationBuffer(), filename: PARAMETER_EDITS_SPECIFICATION_FILENAME });
  expect(created.status).toBe(200);
  const posts = quickSteps(created.body.quickTest.plan).find((step) => step.operationKey === "GET /api/v1/posts")!;
  return { agent, posts };
}

describe("PUT /plan parameterEdits", () => {
  beforeEach(() => resetStore());

  it("saves an edit, marks the step, shows it in the preview and makes the script out of date", async () => {
    const { agent, posts } = await parameterEditsAgent();
    expect((await agent.post(`${QUICK_BASE}/script`)).status).toBe(200);

    const saved = await agent.put(`${QUICK_BASE}/plan`).send({
      parameterEdits: { [posts.id]: { parameters: [{ location: "query", name: "sort", action: "set", value: "oldest" }, { location: "query", name: "limit", action: "omit" }] } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.plan.parameterEdits).toHaveLength(1);
    expect(quickSteps(saved.body.plan).find((step) => step.id === posts.id)).toMatchObject({ parametersEdited: true });
    expect(saved.body.script.outOfDate).toBe(true);

    const preview = (await agent.get(`${QUICK_BASE}/plan/steps/${posts.id}/request`)).body.request;
    expect(preview.parameterEdit.edited).toBe(true);
    const sent = new Map(preview.parameters.map((parameter: { name: string; value: { text?: string } }) => [parameter.name, parameter.value.text]));
    expect(sent.get("sort")).toBe("oldest");
    expect(sent.has("limit")).toBe(false);

    const reset = await agent.put(`${QUICK_BASE}/plan`).send({ parameterEdits: { [posts.id]: null } });
    expect(reset.body.plan.parameterEdits).toEqual([]);
  });

  it("refuses an edit with 400 and its code, naming the parameter, and leaves the plan unchanged", async () => {
    const { agent, posts } = await parameterEditsAgent();
    const before = (await agent.get(`${QUICK_BASE}/plan`)).body.plan.fingerprint;
    const refused = await agent.put(`${QUICK_BASE}/plan`).send({
      parameterEdits: { [posts.id]: { parameters: [{ location: "header", name: "X-Signing-Key", action: "set", value: "typed-secret" }] } },
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "parameter_secret_literal", stepId: posts.id, location: "header", name: "X-Signing-Key" });
    expect(JSON.stringify(refused.body)).not.toContain("typed-secret");
    expect((await agent.get(`${QUICK_BASE}/plan`)).body.plan.fingerprint).toBe(before);
  });
});
