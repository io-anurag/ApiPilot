import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../fixtures/execution/driveWorkflow";

/**
 * specs/056 FR-052, US4 scenario 8, US5 scenario 7: a workflow built from a capture keeps every
 * existing execution safeguard. The capture's hosts are never carried into a generated artifact, so
 * the only address a run can target is the base URL of an environment the user selected, and the
 * confirmation gates apply exactly as they do for an OpenAPI-backed workflow.
 */

const fixture = path.join(__dirname, "..", "fixtures", "apiInput", "har", "realistic.har");
const rawText = readFileSync(fixture, "utf-8");
const CAPTURE_HOSTS = [...new Set([...rawText.matchAll(/"url":\s*"https?:\/\/([^/"]+)/g)].map((match) => match[1]))];

const BASE = "http://127.0.0.1:9";

async function workflowFromCapture() {
  const agent = request.agent(createApp());
  const workflow = await driveToPostmanGenerationComplete(agent, {
    specification: { buffer: Buffer.from(rawText), filename: "realistic.har" },
  });
  return { agent, workflow };
}

/** A value for every variable the capture-derived collection declares, except the base URL. */
function variableValuesFor(workflow: Awaited<ReturnType<typeof workflowFromCapture>>["workflow"]): Record<string, string> {
  const keys = (workflow.postmanArtifact?.environment.values ?? []).map((entry) => entry.key).filter((key) => key !== "baseUrl");
  return Object.fromEntries(keys.map((key) => [key, "test-value"]));
}

describe("execution safeguards for a workflow built from a capture", () => {
  beforeEach(() => resetStore());

  it("reaches Postman generation from the capture", async () => {
    const { workflow } = await workflowFromCapture();
    expect(workflow.stages.postmanGeneration.status).toBe("complete");
    expect(CAPTURE_HOSTS.length).toBeGreaterThan(1);
  });

  it("refuses to start without a selected environment, and unknown environments, and sends nothing", async () => {
    const { agent } = await workflowFromCapture();
    const none =await agent.post("/api/test-generation-workflow/execution/start").send({});
    expect(none.status).toBe(400);
    expect(none.body.error).toBe("invalid_request");
    const unknown = await agent.post("/api/test-generation-workflow/execution/start").send({ environmentId: "does-not-exist" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("environment_not_found");
  });

  it("requires confirmation for a production environment, naming the write operations the run would send", async () => {
    const { agent, workflow } = await workflowFromCapture();
    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Production",
      tier: "production",
      baseUrl: BASE,
      variableValues: variableValuesFor(workflow),
    });
    expect(env.status).toBe(200);
    const refused = await agent.post("/api/test-generation-workflow/execution/start").send({ environmentId: env.body.environment.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("confirmation_required");
    expect(refused.body.environmentTier).toBe("production");
    expect(refused.body.destructiveOperations.length).toBeGreaterThan(0);
  });

  it("also requires confirmation for a local environment while write operations are approved", async () => {
    const { agent, workflow } = await workflowFromCapture();
    const env = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl: BASE,
      variableValues: variableValuesFor(workflow),
    });
    const refused = await agent.post("/api/test-generation-workflow/execution/start").send({ environmentId: env.body.environment.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("confirmation_required");
  });

  it("carries none of the capture's hosts into the collection, the environment or the readme", async () => {
    const { workflow } = await workflowFromCapture();
    const artifact = workflow.postmanArtifact;
    expect(artifact).toBeDefined();
    const text = JSON.stringify({ collection: artifact?.collection, environment: artifact?.environment, readme: artifact?.readme });
    for (const host of CAPTURE_HOSTS) expect(text, `artifact contains ${host}`).not.toContain(host);
  });

  it("addresses every request through {{baseUrl}} and nothing else", async () => {
    const { workflow } = await workflowFromCapture();
    // The items only: the collection's `info.schema` is the Postman schema URL, not a request address.
    const items = JSON.stringify(workflow.postmanArtifact?.collection.item);
    const urls = [...items.matchAll(/"url":\{"raw":"([^"]*)"/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const raw of urls) expect(raw.startsWith("{{baseUrl}}"), raw).toBe(true);
    expect(items).not.toMatch(/https?:\/\//);
  });
});
