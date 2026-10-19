import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { SECRET_BEARER_TOKEN } from "../../fixtures/securityLab/secretCorpus";
import { VALID_SPECIFICATION_FILENAME, validSpecificationBuffer } from "../../fixtures/testGenerationWorkflow/workflowFixtures";

const BASE = "/api/security-lab/environments";
const TARGET = { name: "Local sample", tier: "local", baseUrl: "http://127.0.0.1:4700" };

describe("Security Lab target environments (research R8, revised)", () => {
  it("creates, lists and edits a target carrying only name, tier and baseUrl", async () => {
    const agent = request.agent(createApp());
    expect((await agent.get(BASE)).body).toEqual({ environments: [] });

    const created = await agent.post(BASE).send(TARGET);
    expect(created.status).toBe(200);
    expect(created.body.environment).toMatchObject({ name: "Local sample", tier: "local", baseUrl: "http://127.0.0.1:4700" });
    expect(Object.keys(created.body.environment).sort()).toEqual(["baseUrl", "id", "name", "tier"]);

    const edited = await agent
      .put(`${BASE}/${created.body.environment.id}`)
      .send({ ...TARGET, baseUrl: "http://127.0.0.1:4701/" });
    expect(edited.status).toBe(200);
    expect(edited.body.environment.baseUrl).toBe("http://127.0.0.1:4701");
    expect((await agent.get(BASE)).body.environments).toHaveLength(1);
  });

  it("works with no specification loaded, and does not change the existing environment gate (AP-032)", async () => {
    const agent = request.agent(createApp());
    expect((await agent.post(BASE).send(TARGET)).status).toBe(200);
    // The existing routes stay closed for a session that has done nothing that opens them.
    const existing = await agent.get("/api/test-generation-workflow/environments");
    expect(existing.status).toBe(409);
    expect(existing.body.error).toBe("stage_not_active");

    // An uploaded-only guided workflow still does not open them either.
    await agent.post("/api/test-generation-workflow").attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    expect((await agent.get("/api/test-generation-workflow/environments")).status).toBe(409);
  });

  it("never accepts or returns variable values, even when sent one", async () => {
    const agent = request.agent(createApp());
    const created = await agent
      .post(BASE)
      .send({ ...TARGET, variableValues: { token: SECRET_BEARER_TOKEN }, requestDelayMs: 500 });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.body)).not.toContain(SECRET_BEARER_TOKEN);
    expect(JSON.stringify((await agent.get(BASE)).body)).not.toContain(SECRET_BEARER_TOKEN);
    expect(JSON.stringify(created.body)).not.toContain("variableValues");
  });

  it("keeps the variables an environment already holds when its target is edited", async () => {
    const agent = request.agent(createApp());
    await driveToPostmanGenerationComplete(agent);
    // Created the way the rest of the product does, with a variable value.
    const existing = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Shared",
      tier: "local",
      baseUrl: "http://127.0.0.1:4700",
      variableValues: { apiKey: "keep-me" },
      requestDelayMs: 250,
    });
    const id = existing.body.environment.id as string;

    // Security Lab lists it without the variables, and editing its target leaves them alone.
    const listed = await agent.get(BASE);
    expect(listed.body.environments).toEqual([{ id, name: "Shared", tier: "local", baseUrl: "http://127.0.0.1:4700" }]);
    const edited = await agent.put(`${BASE}/${id}`).send({ name: "Renamed", tier: "dev", baseUrl: "http://127.0.0.1:4701" });
    expect(edited.status).toBe(200);

    const after = await agent.get("/api/test-generation-workflow/environments");
    expect(after.body.environments[0]).toMatchObject({
      name: "Renamed",
      tier: "dev",
      baseUrl: "http://127.0.0.1:4701",
      variableValues: { apiKey: "keep-me" },
      requestDelayMs: 250,
    });
  });

  it("validates the body with a named reason", async () => {
    const agent = request.agent(createApp());
    const bad = async (body: unknown) => (await agent.post(BASE).send(body as object)).body;
    expect((await bad({ ...TARGET, name: "" })).error).toBe("invalid_request");
    expect((await bad({ ...TARGET, tier: "prod" })).error).toBe("invalid_request");
    expect((await bad({ ...TARGET, baseUrl: "not a url" })).error).toBe("invalid_request");
    expect((await bad({ ...TARGET, baseUrl: "ftp://example.test" })).message).toMatch(/http or https/);
    expect((await bad({ ...TARGET, baseUrl: "http://user:pass@127.0.0.1:4700" })).message).toMatch(/credentials/);
  });

  it("refuses a duplicate name and an unknown id with the documented codes", async () => {
    const agent = request.agent(createApp());
    await agent.post(BASE).send(TARGET);
    const duplicate = await agent.post(BASE).send(TARGET);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("duplicate_environment_name");
    const missing = await agent.put(`${BASE}/does-not-exist`).send(TARGET);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("environment_not_found");
  });

  it("scopes targets to the session: another session sees none", async () => {
    const app = createApp();
    await request.agent(app).post(BASE).send(TARGET);
    expect((await request.agent(app).get(BASE)).body.environments).toEqual([]);
  });
});
