import request from "supertest";
import type { K6Readiness } from "@apipilot/shared-domain";
import { createApp } from "../../../src/app";
import type { PerformanceTestingDependencies } from "../../../src/api/performanceTesting";
import type { K6Probe } from "../../../src/performance/k6/runnerTypes";
import { driveToPostmanGenerationComplete } from "../execution/driveWorkflow";
import { SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET } from "./builders";
import { establishSession } from "./session";
import { PERFORMANCE_SPECIFICATION_FILENAME, performanceSpecificationBuffer } from "./specification";

export const PERFORMANCE_BASE = "/api/test-generation-workflow/performance";

export function readyProbe(version = "1.2.0"): K6Probe {
  return async () => ({ readiness: { state: "ready", version, checkedAt: "2026-09-27T12:00:00.000Z" }, binaryPath: "k6" });
}

export function unavailableProbe(readiness: K6Readiness = { state: "unavailable", reason: "not-found", checkedAt: "2026-09-27T12:00:00.000Z" }): K6Probe {
  return async () => ({ readiness });
}

export interface PerformanceAgent {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
  environmentId: string;
}

/**
 * A supertest agent for `performance.yaml` driven through Postman generation, with an environment
 * holding the seeded secrets. `options.drive: false` stops before the workflow is started.
 */
export async function performanceAgent(
  deps: Partial<PerformanceTestingDependencies>,
  options: { drive?: boolean; tier?: string; variableValues?: Record<string, string> } = {},
): Promise<PerformanceAgent> {
  const agent = request.agent(createApp(undefined, { performance: { probe: unavailableProbe(), ...deps } }));
  const sessionId = await establishSession(agent);
  if (options.drive === false) return { agent, sessionId, environmentId: "" };
  await driveToPostmanGenerationComplete(agent, {
    specification: { buffer: performanceSpecificationBuffer(), filename: PERFORMANCE_SPECIFICATION_FILENAME },
  });
  const environment = await agent.post("/api/test-generation-workflow/environments").send({
    name: "perf-local",
    tier: options.tier ?? "local",
    baseUrl: "http://127.0.0.1:4600",
    variableValues: options.variableValues ?? { clientId: SEEDED_CLIENT_ID, clientSecret: SEEDED_CLIENT_SECRET, warehouseId: "wh-1" },
  });
  return { agent, sessionId, environmentId: environment.body.environment.id };
}

/** Sets the fixture's GET /status expected status, then generates the script. */
export async function generateReadyScript(agent: PerformanceAgent["agent"]): Promise<{ scriptSha256: string }> {
  const plan = (await agent.get(`${PERFORMANCE_BASE}/plan`)).body.plan;
  const statusStep = plan.journeys.flatMap((j: { steps: { id: string; operationKey: string }[] }) => j.steps).find((s: { operationKey: string }) => s.operationKey === "GET /status");
  await agent.put(`${PERFORMANCE_BASE}/plan`).send({ expectedStatuses: { [statusStep.id]: ["200"] } });
  const generated = await agent.post(`${PERFORMANCE_BASE}/script`);
  return generated.body.script;
}
