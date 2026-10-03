import request from "supertest";
import type { ChainPlan, ChainPlanInput } from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import type { PerformanceTestingDependencies } from "../../../src/api/performanceTesting";
import { unavailableProbe } from "../performance/agent";
import { establishSession } from "../performance/session";

/** AP-037 (specs/037-request-chain-performance tasks T020): request-chain plan routes. */
export const CHAIN_BASE = "/api/chain-plans";

export interface ChainAgent {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
}

export async function chainAgent(deps: Partial<PerformanceTestingDependencies> = {}): Promise<ChainAgent> {
  const agent = request.agent(createApp(undefined, { performance: { probe: unavailableProbe(), ...deps } }));
  const sessionId = await establishSession(agent);
  return { agent, sessionId };
}

/** What the editor sends for `plan`: everything but what only the server sets. */
export function inputOf(plan: ChainPlan): ChainPlanInput {
  return {
    name: plan.name,
    chains: plan.chains.map((chain) => ({
      id: chain.id,
      name: chain.name,
      steps: chain.steps.map(({ source: _source, seedDigest: _digest, changed: _changed, ...rest }) => rest),
    })),
    loadProfile: plan.loadProfile,
    thinkTimeMs: plan.thinkTimeMs,
    thresholds: plan.thresholds,
    targetEnvironmentId: plan.targetEnvironmentId,
    secretNames: plan.secretNames,
    seedingReport: plan.seedingReport,
    nextChainNumber: plan.nextChainNumber,
    nextStepNumber: plan.nextStepNumber,
    nextItemNumber: plan.nextItemNumber,
  };
}

/** Creates an empty plan and returns it. */
export async function newPlan(agent: ChainAgent["agent"], name = "Customer lifecycle"): Promise<ChainPlan> {
  const created = await agent.post(CHAIN_BASE).send({ name });
  if (created.status !== 201) throw new Error(`Plan not created: ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.plan as ChainPlan;
}

/** Saves `plan`'s content (as built by a fixture) over the stored plan at its revision. */
export function savePlanContent(agent: ChainAgent["agent"], stored: ChainPlan, content: ChainPlan) {
  return agent.put(`${CHAIN_BASE}/${stored.id}`).send({ revision: stored.revision, plan: inputOf({ ...content, id: stored.id }) });
}

/** An environment for the session; a plan must exist first (it opens environments). */
export async function createEnvironment(agent: ChainAgent["agent"], variableValues: Record<string, string> = {}, name = "Local stub"): Promise<string> {
  const created = await agent.post("/api/test-generation-workflow/environments").send({ name, tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues });
  if (created.status !== 200) throw new Error(`Environment not created: ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.environment.id as string;
}
