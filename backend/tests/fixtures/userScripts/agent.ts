import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { createApp } from "../../../src/app";
import type { PerformanceTestingDependencies } from "../../../src/api/performanceTesting";
import { unavailableProbe } from "../performance/agent";
import { establishSession } from "../performance/session";

/** AP-034 route helpers (specs/034-run-user-k6-script contracts/user-scripts-api.md). */
export const USER_SCRIPTS_BASE = "/api/user-scripts";

export interface UserScriptAgent {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
}

export async function userScriptAgent(deps: Partial<PerformanceTestingDependencies> = {}): Promise<UserScriptAgent> {
  const agent = request.agent(createApp(undefined, { performance: { probe: unavailableProbe(), ...deps } }));
  const sessionId = await establishSession(agent);
  return { agent, sessionId };
}

export function scriptFixture(kind: "accepted" | "refused", name: string): Buffer {
  return readFileSync(path.join(__dirname, kind, name));
}

export function uploadScript(agent: UserScriptAgent["agent"], bytes: Buffer, name = "Orders") {
  return agent
    .post(`${USER_SCRIPTS_BASE}/upload?name=${encodeURIComponent(name)}`)
    .set("Content-Type", "application/octet-stream")
    .send(bytes);
}

export async function environmentFor(agent: UserScriptAgent["agent"], values: Record<string, string> = {}, name = "Local stub"): Promise<string> {
  const created = await agent.post("/api/test-generation-workflow/environments").send({ name, tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: values });
  if (created.status !== 200) throw new Error(`Environment not created: ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.environment.id;
}

export async function waitUntilSettled(agent: UserScriptAgent["agent"], runId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = (await agent.get(`${USER_SCRIPTS_BASE}/runs/${runId}`)).body.run;
    if (run && run.status !== "in-progress") return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The run did not settle.");
}
