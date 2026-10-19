import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../../../src/app";
import type { SecurityLabDependencies } from "../../../src/securityLab/securityLabService";
import { ALICE_KEY, ALICE_TOKEN, BOB_KEY, BOB_TOKEN } from "./runFixtures";
import type { RawTarget } from "./rawTarget";
import { startSampleTarget, type TargetBehavior } from "./sampleTargets";

const BASE = "/api/security-lab";
const FIXTURES = path.resolve(__dirname);

export type Agent = ReturnType<typeof request.agent>;

export interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly agent: Agent;
  readonly target: RawTarget;
  readonly sessionId: string;
  readonly ownerId: string;
  readonly environmentId: string;
  /** The base URL of the target environment, which a staging-like run must retype to confirm. */
  readonly baseUrl: string;
  profileId: string;
  stop(): Promise<void>;
}

export interface HarnessOptions {
  readonly behavior?: TargetBehavior;
  readonly securityLab?: Partial<SecurityLabDependencies>;
  /** Overrides applied to the profile body. */
  readonly profile?: Record<string, unknown>;
  readonly tier?: "local" | "staging";
  readonly withSpecification?: boolean;
  /** Points the environment somewhere other than the loopback target, for tests that inject a fake sender. */
  readonly baseUrl?: string;
}

export const ALL_EXECUTABLE_CATEGORIES = [
  "authentication",
  "authorization",
  "broken-object-level-authorization",
  "object-property-authorization",
  "input-validation",
  "resource-consumption",
  "sensitive-data-exposure",
  "security-misconfiguration",
];

function cookie(headers: Record<string, unknown>, name: string): string {
  const found = (headers["set-cookie"] as string[]).find((entry) => entry.startsWith(`${name}=`));
  return decodeURIComponent((found as string).split(";")[0].split("=")[1]);
}

/** An app, a session, a loopback target and a valid local profile with two identities holding every credential. */
export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const target = await startSampleTarget(options.behavior);
  const app = createApp(undefined, { securityLab: options.securityLab ?? {} });
  const agent = request.agent(app);
  // The first Security Lab response sets both cookies; later responses do not, so read them here.
  const probe = await agent.get(`${BASE}/profiles`);
  const sessionId = cookie(probe.headers, "sessionId");
  const ownerId = cookie(probe.headers, "apipilotOwner");
  if (options.withSpecification !== false) {
    const upload = await agent.post("/api/test-generation-workflow").attach("file", readFileSync(path.join(FIXTURES, "sample-api.yaml")), "sample-api.yaml");
    expect(upload.status).toBe(200);
  }

  const tier = options.tier ?? "local";
  const environment = await agent.post(`${BASE}/environments`).send({ name: "Sample target", tier, baseUrl: options.baseUrl ?? target.origin });
  expect(environment.status).toBe(200);
  const environmentId = environment.body.environment.id as string;

  const harness: Harness = { app, agent, target, sessionId, ownerId, environmentId, baseUrl: environment.body.environment.baseUrl as string, profileId: "", stop: () => target.stop() };
  const created = await agent.post(`${BASE}/profiles`).send(profileBody(harness, options.profile));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  harness.profileId = created.body.profile.id as string;
  await setCredentials(harness);
  return harness;
}

export function profileBody(harness: Pick<Harness, "target" | "environmentId">, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Sample profile",
    environmentId: harness.environmentId,
    allowedHosts: ["127.0.0.1"],
    allowedPorts: [harness.target.portNumber],
    allowedAddressRanges: ["127.0.0.1"],
    permittedCategories: ALL_EXECUTABLE_CATEGORIES,
    identities: [
      { name: "alice", role: "owner", credentialSchemes: ["bearerAuth", "apiKeyAuth"], expiredCredentialSchemes: ["bearerAuth"] },
      { name: "bob", role: "other-user", credentialSchemes: ["bearerAuth", "apiKeyAuth"] },
    ],
    testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "ord-1001" }],
    maxRequests: 200,
    maxConcurrency: 2,
    timeoutMs: 5_000,
    ...overrides,
  };
}

export async function setCredentials(harness: Harness): Promise<void> {
  const entries: Array<[string, string, string, string]> = [
    ["alice", "bearerAuth", "active", ALICE_TOKEN],
    ["bob", "bearerAuth", "active", BOB_TOKEN],
    ["alice", "apiKeyAuth", "active", ALICE_KEY],
    ["bob", "apiKeyAuth", "active", BOB_KEY],
    ["alice", "bearerAuth", "expired", "sl-fixture-alice-expired-token"],
  ];
  for (const [identity, scheme, kind, value] of entries) {
    const res = await harness.agent.put(`${BASE}/profiles/${harness.profileId}/credentials`).send({ identity, scheme, kind, value });
    expect(res.status).toBe(204);
  }
}

export async function generateAll(harness: Harness): Promise<void> {
  const res = await harness.agent.post(`${BASE}/scenarios/generate`).send({ scope: { mode: "all" }, profileId: harness.profileId });
  expect(res.status).toBe(200);
}

export interface ScenarioRef {
  id: string;
  version: number;
}

export async function scenarioIds(harness: Harness, query: string): Promise<ScenarioRef[]> {
  const res = await harness.agent.get(`${BASE}/scenarios/ids?${query}`);
  expect(res.status).toBe(200);
  return res.body.items as ScenarioRef[];
}

/** Submits and approves the named scenarios, confirming destructive ones by name. */
export async function approve(harness: Harness, items: ScenarioRef[]): Promise<void> {
  const submit = await harness.agent.post(`${BASE}/scenarios/review`).send({ action: "submit", items });
  expect(submit.status).toBe(200);
  const approved = await harness.agent.post(`${BASE}/scenarios/review`).send({ action: "approve", items, destructiveConfirmations: items.map((item) => item.id) });
  expect(approved.status).toBe(200);
  expect(approved.body.refused, JSON.stringify(approved.body.refused)).toEqual([]);
}

export function runBody(harness: Harness, items: ScenarioRef[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { profileId: harness.profileId, items, ...extra };
}

export async function preview(harness: Harness, items: ScenarioRef[], extra: Record<string, unknown> = {}) {
  return harness.agent.post(`${BASE}/runs/preview`).send(runBody(harness, items, extra));
}

export function confirmationFor(harness: Harness, previewBody: { summary: { destructive: Array<{ scenarioId: string }> } }, overrides: Record<string, unknown> = {}) {
  return {
    targetName: "Sample target",
    targetBaseUrl: harness.baseUrl,
    authorizationAttested: true,
    destructiveScenarioIds: previewBody.summary.destructive.map((entry) => entry.scenarioId),
    ...overrides,
  };
}

/** Previews, then starts with a correct confirmation. */
export async function startRun(harness: Harness, items: ScenarioRef[], extra: Record<string, unknown> = {}) {
  const previewed = await preview(harness, items, extra);
  expect(previewed.status).toBe(200);
  return harness.agent.post(`${BASE}/runs`).send({ ...runBody(harness, items, extra), planDigest: previewed.body.planDigest, confirmation: confirmationFor(harness, previewed.body) });
}

export async function waitForRun(harness: Harness, runId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await harness.agent.get(`${BASE}/runs/${runId}`);
    expect(res.status).toBe(200);
    if (res.body.run.status !== "in-progress") return res.body;
    if (Date.now() > deadline) throw new Error("The run did not settle in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
