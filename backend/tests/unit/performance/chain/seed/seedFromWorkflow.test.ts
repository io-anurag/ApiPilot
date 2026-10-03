import { describe, expect, it } from "vitest";
import { analyzeChainPlan } from "@apipilot/shared-domain";
import { assembleSeededPlan } from "../../../../../src/performance/chain/seed/assembleSeededPlan";
import { seedFromWorkflow } from "../../../../../src/performance/chain/seed/seedFromWorkflow";
import { buildPlan } from "../../../../../src/performance/plan/buildPlan";
import { performanceContext } from "../../../../fixtures/performance/context";

/** AP-037 (specs/037-request-chain-performance tasks T067; US4, FR-022, FR-023; research R16). */

const NOW = "2026-10-03T12:00:00.000Z";

async function seed() {
  const context = await performanceContext();
  return { context, seeded: assembleSeededPlan({ ...seedFromWorkflow(context, "Performance fixture", "Seeded", NOW), environment: null }) };
}

describe("seedFromWorkflow", () => {
  it("gives credentials first, one chain per approved workflow, then one single-step chain per other operation", async () => {
    const { context, seeded } = await seed();
    const plan = seeded.plan;
    const guided = buildPlan(context);
    const workflowJourneys = guided.journeys.filter((journey) => journey.source.kind === "workflow");
    expect(workflowJourneys.length).toBeGreaterThan(0);
    const names = plan.chains.map((chain) => chain.name);
    expect(names[0]).toBe("Credentials");
    expect(plan.chains[0].steps.every((step) => step.runs === "once-before-load" && step.extractors.length === 1)).toBe(true);
    expect(names.filter((name) => name.startsWith("Workflow "))).toHaveLength(workflowJourneys.length);
    const singles = plan.chains.filter((chain) => !chain.name.startsWith("Workflow ") && chain.name !== "Credentials");
    expect(singles.every((chain) => chain.steps.length === 1 && chain.steps[0].source.kind === "operation")).toBe(true);
    expect(plan.seedingReport?.source).toEqual({ kind: "workflow", specificationTitle: "Performance fixture" });
  });

  it("turns each workflow variable into an extractor on its producer and a reference on its consumers, in order", async () => {
    const { seeded } = await seed();
    const workflow = seeded.plan.chains.find((chain) => chain.name.startsWith("Workflow "))!;
    const extracted = workflow.steps.flatMap((step) => step.extractors.map((extractor) => extractor.name));
    expect(extracted.length).toBeGreaterThan(0);
    const consumer = workflow.steps.find((step, index) => index > 0 && extracted.some((name) => JSON.stringify(step).includes(`{{${name}}}`)));
    expect(consumer).toBeDefined();
    expect(workflow.steps.every((step) => step.source.kind === "workflow")).toBe(true);
    expect(JSON.stringify(seeded.plan)).not.toMatch(/apipilot_(c|unique)_/);
    const blockers = analyzeChainPlan(seeded.plan, { environmentValueNames: null }).blockers;
    expect(blockers.filter((blocker) => blocker.kind === "use-before-extraction" || blocker.kind === "invalid-reference")).toEqual([]);
  });

  it("is deterministic", async () => {
    const first = (await seed()).seeded.plan;
    const second = (await seed()).seeded.plan;
    expect(second.chains).toEqual(first.chains);
    expect(second.fingerprint).toBe(first.fingerprint);
  });
});
