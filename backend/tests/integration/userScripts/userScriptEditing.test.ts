import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkUserScript } from "../../../src/performance/userScript/checkUserScript";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { scriptFixture, uploadScript, USER_SCRIPTS_BASE, userScriptAgent } from "../../fixtures/userScripts/agent";

/** AP-034 US3 (FR-010, FR-011, FR-016; SC-008; research R6; tasks T057). */

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("the example and new scripts", () => {
  it("serves a fixed example that the check accepts, that reads BASE_URL and holds no credential", async () => {
    const { agent } = await userScriptAgent();
    const example = await agent.get(`${USER_SCRIPTS_BASE}/example`);
    expect(example.status).toBe(200);
    const result = checkUserScript(Buffer.from(example.text));
    expect(result).toMatchObject({ accepted: true, envNames: [{ name: "BASE_URL" }] });
    expect(example.text).not.toMatch(/password|secret|token|apikey|api_key|bearer/i);
  });

  it("creates a script from the editor's text", async () => {
    const { agent } = await userScriptAgent();
    const created = await agent.post(USER_SCRIPTS_BASE).send({ name: "  From the editor  ", content: "export default function () {}\n" });
    expect(created.status).toBe(201);
    expect(created.body.script).toMatchObject({ name: "From the editor", confirmed: false, sha256: sha256(Buffer.from("export default function () {}\n")) });
  });
});

describe("saving a new version", () => {
  it("stores a new SHA-256 and clears the confirmation; a stale base stores nothing (FR-016)", async () => {
    const { agent } = await userScriptAgent();
    const uploaded = (await uploadScript(agent, scriptFixture("accepted", "basic.js"))).body.script;
    await agent.post(`${USER_SCRIPTS_BASE}/${uploaded.id}/confirmation`).send({ sha256: uploaded.sha256 });

    const saved = await agent.put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content`).send({ content: "export default function () { }\n", baseSha256: uploaded.sha256 });
    expect(saved.status).toBe(200);
    expect(saved.body.script).toMatchObject({ confirmed: false, confirmation: null });
    expect(saved.body.script.sha256).not.toBe(uploaded.sha256);

    const stale = await agent.put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content`).send({ content: "export default function () {}\n", baseSha256: uploaded.sha256 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("script_changed");
    expect((await agent.get(`${USER_SCRIPTS_BASE}/${uploaded.id}`)).body.script.sha256).toBe(saved.body.script.sha256);
  });

  it("refuses a save the check refuses, with its problems, and keeps the stored version (FR-011)", async () => {
    const { agent } = await userScriptAgent();
    const uploaded = (await uploadScript(agent, scriptFixture("accepted", "basic.js"))).body.script;
    const refused = await agent
      .put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content`)
      .send({ content: 'import x from "https://jslib.k6.io/x.js";\nexport default function () {}\n', baseSha256: uploaded.sha256 });
    expect(refused.status).toBe(422);
    expect(refused.body.problems).toEqual([expect.objectContaining({ rule: "import-remote", line: 1 })]);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/${uploaded.id}`)).body.script.sha256).toBe(uploaded.sha256);
  });

  it("merges the mapping after a content change", async () => {
    const { agent } = await userScriptAgent();
    const uploaded = (await uploadScript(agent, scriptFixture("accepted", "basic.js"))).body.script;
    const saved = await agent.put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content`).send({ content: "export default function () { return __ENV.TENANT; }\n", baseSha256: uploaded.sha256 });
    expect(saved.body.script.settings.mapping.map((entry: { name: string; foundInScript: boolean }) => `${entry.name}:${entry.foundInScript}`)).toEqual(["API_KEY:false", "BASE_URL:false", "TENANT:true"]);
  });
});

describe("replacing with an upload and downloading", () => {
  it("replaces the bytes exactly, CRLF included, clears the confirmation, and downloads them exactly", async () => {
    const { agent } = await userScriptAgent();
    const uploaded = (await uploadScript(agent, scriptFixture("accepted", "basic.js"))).body.script;
    await agent.post(`${USER_SCRIPTS_BASE}/${uploaded.id}/confirmation`).send({ sha256: uploaded.sha256 });
    const crlf = Buffer.from('import http from "k6/http";\r\nexport default function () { http.get(`${__ENV.BASE_URL}/`); }\r\n');
    const replaced = await agent
      .put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content?baseSha256=${uploaded.sha256}`)
      .set("Content-Type", "application/octet-stream")
      .send(crlf);
    expect(replaced.status).toBe(200);
    expect(replaced.body.script).toMatchObject({ sha256: sha256(crlf), confirmed: false });

    const download = await agent.get(`${USER_SCRIPTS_BASE}/${uploaded.id}/download`).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(download.headers["content-disposition"]).toBe('attachment; filename="Orders.js"');
    expect((download.body as Buffer).equals(crlf)).toBe(true);

    const wrongType = await agent.put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content`).set("Content-Type", "text/plain").send("x");
    expect(wrongType.status).toBe(415);
  });

  it("starts no run after a save or a replacement (SC-008)", async () => {
    const runner = createFakeRunner({ lines: [] });
    const { agent } = await userScriptAgent({ runner, probe: readyProbe() });
    const uploaded = (await uploadScript(agent, scriptFixture("accepted", "basic.js"))).body.script;
    const saved = await agent.put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content`).send({ content: "export default function () {}\n", baseSha256: uploaded.sha256 });
    await agent
      .put(`${USER_SCRIPTS_BASE}/${uploaded.id}/content?baseSha256=${saved.body.script.sha256}`)
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("export default function () { }\n"));
    expect(runner.starts).toHaveLength(0);
    expect((await agent.get(`${USER_SCRIPTS_BASE}/runs`)).body.runs).toEqual([]);
  });
});
