import { beforeEach, describe, expect, it } from "vitest";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { generateQuickScript, QUICK_BASE, quickAgent, uploadQuick, type QuickAgent } from "../../fixtures/performance/quickAgent";
import { PERFORMANCE_SPECIFICATION_FILENAME, performanceSpecificationBuffer } from "../../fixtures/performance/specification";

/** AP-032 FR-007 / SC-004 and FR-021 (specs/032-quick-performance-test tasks T021). */

async function downloads(agent: QuickAgent["agent"]): Promise<{ script: string; template: string }> {
  const script = await agent.get(`${QUICK_BASE}/script/download?file=script`).buffer(true);
  const template = await agent.get(`${QUICK_BASE}/script/download?file=environment-template`).buffer(true);
  expect(script.status).toBe(200);
  expect(template.status).toBe(200);
  return { script: script.text, template: template.text };
}

describe("quick performance test determinism and isolation", () => {
  beforeEach(() => resetStore());

  it("gives byte-identical script and environment template for two uploads of the same file with the same edits (SC-004)", async () => {
    const first = await quickAgent();
    const second = await quickAgent();
    await uploadQuick(first.agent);
    await uploadQuick(second.agent);
    const firstScript = await generateQuickScript(first.agent);
    const secondScript = await generateQuickScript(second.agent);
    expect(secondScript.scriptSha256).toBe(firstScript.scriptSha256);

    // Set seeded secrets in an environment of the first session; no generated file may carry them.
    const environment = await first.agent.post("/api/test-generation-workflow/environments").send({
      name: "quick-local",
      tier: "local",
      baseUrl: "http://127.0.0.1:4600",
      variableValues: { token: SEEDED_CLIENT_SECRET, orderId: SEEDED_CLIENT_ID },
    });
    expect(environment.status).toBe(200);

    const a = await downloads(first.agent);
    const b = await downloads(second.agent);
    expect(b.script).toBe(a.script);
    expect(b.template).toBe(a.template);
    for (const text of [a.script, a.template]) {
      expect(text).not.toContain(SEEDED_CLIENT_SECRET);
      expect(text).not.toContain(SEEDED_CLIENT_ID);
    }

    // A replace in the same session gives the same bytes again.
    await uploadQuick(first.agent, { replaceExisting: true });
    await generateQuickScript(first.agent);
    expect((await downloads(first.agent)).script).toBe(a.script);
  });

  it("never reads or changes the guided workflow, and the guided workflow never changes the quick test (FR-021)", async () => {
    const { agent } = await quickAgent();
    const guided = await agent
      .post("/api/test-generation-workflow")
      .attach("file", performanceSpecificationBuffer(), PERFORMANCE_SPECIFICATION_FILENAME);
    expect(guided.status).toBe(200);
    const before = (await agent.get("/api/test-generation-workflow")).body;

    await uploadQuick(agent);
    await uploadQuick(agent, { replaceExisting: true });
    await generateQuickScript(agent);
    expect((await agent.get("/api/test-generation-workflow")).body).toEqual(before);

    const quickBefore = (await agent.get(QUICK_BASE)).body;
    expect((await agent.delete("/api/test-generation-workflow")).status).toBe(204);
    await agent.post("/api/test-generation-workflow").attach("file", performanceSpecificationBuffer(), PERFORMANCE_SPECIFICATION_FILENAME);
    expect((await agent.get(QUICK_BASE)).body).toEqual(quickBefore);
  });
});
