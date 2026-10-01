import { describe, expect, it } from "vitest";
import { scriptFixture, uploadScript, userScriptAgent } from "../../fixtures/userScripts/agent";

/** AP-034 FR-024 (research R18; tasks T026): a stored script opens environments to its session. */
const ENVIRONMENTS = "/api/test-generation-workflow/environments";

describe("environment access for Run k6 Script", () => {
  it("stays closed with no script, Postman generation or quick test, and opens once a script is stored", async () => {
    const { agent } = await userScriptAgent();
    const closed = await agent.get(ENVIRONMENTS);
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe("stage_not_active");

    await uploadScript(agent, scriptFixture("accepted", "basic.js"));
    expect((await agent.get(ENVIRONMENTS)).status).toBe(200);
    const created = await agent.post(ENVIRONMENTS).send({ name: "Local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: {} });
    expect(created.status).toBe(200);
  });

  it("does not open them for a refused upload", async () => {
    const { agent } = await userScriptAgent();
    await uploadScript(agent, scriptFixture("refused", "open-call.js"));
    expect((await agent.get(ENVIRONMENTS)).status).toBe(409);
  });
});
