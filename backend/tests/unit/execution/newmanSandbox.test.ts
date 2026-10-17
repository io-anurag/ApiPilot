import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSandboxEnvironment, buildSandboxExecArgv, NewmanSandbox } from "../../../src/execution/newmanSandbox";

let outside: string;
let outsideFile: string;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  outside = mkdtempSync(path.join(tmpdir(), "apipilot-sandbox-"));
  outsideFile = path.join(outside, "secret.txt");
  writeFileSync(outsideFile, "db-key-material");
  server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(outside, { recursive: true, force: true });
});

function options(script: string[]) {
  return {
    collection: {
      info: { name: "sandbox-test" },
      item: [
        {
          name: "probe",
          event: [{ listen: "test", script: { exec: script } }],
          request: { method: "GET", url: `${baseUrl}/probe` },
        },
      ],
    },
    environment: { values: [] },
    reporters: [],
  };
}

describe("newman sandbox: process-level restriction", () => {
  // These run the exact flags the sandbox child is started with, so they prove what the process
  // itself is denied, independent of what postman-sandbox's own vm context happens to expose.
  function probe(code: string) {
    const result = spawnSync(process.execPath, [...buildSandboxExecArgv(), "-e", code], {
      encoding: "utf-8",
      env: buildSandboxEnvironment({}, ""),
    });
    return { status: result.status, output: result.stdout.trim(), error: result.stderr };
  }

  it("denies reading a file outside the installed packages (e.g. the database key file)", () => {
    const { output } = probe(
      `try { require("fs").readFileSync(${JSON.stringify(outsideFile)}); console.log("READ"); } catch (e) { console.log(e.code); }`,
    );
    expect(output).toBe("ERR_ACCESS_DENIED");
  });

  it("denies writing files", () => {
    const { output } = probe(
      `try { require("fs").writeFileSync(${JSON.stringify(path.join(outside, "w.txt"))}, "x"); console.log("WROTE"); } catch (e) { console.log(e.code); }`,
    );
    expect(output).toBe("ERR_ACCESS_DENIED");
  });

  it("denies spawning processes", () => {
    const { output } = probe(
      `try { require("child_process").spawnSync(process.execPath, ["-v"]); console.log("SPAWNED"); } catch (e) { console.log(e.code); }`,
    );
    expect(output).toBe("ERR_ACCESS_DENIED");
  });

  it("does not hand the backend's environment to the child", () => {
    const environment = buildSandboxEnvironment({ AI_MODEL_ID: "x", SECRET_TOKEN: "y", HTTPS_PROXY: "http://p" }, "/n.js");
    expect(environment).toEqual({ APIPILOT_NEWMAN_ENTRY: "/n.js", HTTPS_PROXY: "http://p" });
  });
});

describe("newman sandbox: running an item", () => {
  let sandbox: NewmanSandbox;
  const runNewmanInSandbox = (options: Record<string, unknown>) => sandbox.run(options);
  beforeAll(async () => {
    sandbox = new NewmanSandbox();
    // The child starts lazily and cold-loads Newman and postman-sandbox, which can take far longer
    // than a steady-state run when the full suite is saturating the machine. Pay that cost here,
    // under a hook timeout sized for it, so the tests below only time the work they exercise.
    await runNewmanInSandbox(options([]));
  }, 120_000);
  afterAll(() => sandbox.close());

  it("runs the item, its tests and environment writes, and returns a plain result", async () => {
    const { execution, environment } = await runNewmanInSandbox(
      options(["pm.test('status is 200', () => pm.response.to.have.status(200));", "pm.environment.set('captured', 'yes');"]),
    );
    expect(execution.response?.code).toBe(200);
    expect(execution.response?.text?.()).toContain('"ok":true');
    expect(execution.assertions?.map((a) => [a.assertion, a.error])).toEqual([["status is 200", undefined]]);
    expect(execution.request?.url?.toString()).toBe(`${baseUrl}/probe`);
    expect(environment.captured).toBe("yes");
  }, 30_000);

  it("a script cannot read a file: require('fs') yields no usable file API and process is not exposed", async () => {
    const { environment } = await runNewmanInSandbox(
      options([
        "const out = {};",
        `try { out.read = require('fs').readFileSync(${JSON.stringify(outsideFile)}, 'utf8'); } catch (e) { out.readError = e.message; }`,
        "out.processType = typeof process;",
        "pm.environment.set('probe', JSON.stringify(out));",
      ]),
    );
    const probe = JSON.parse(String(environment.probe)) as Record<string, string>;
    expect(probe.read).toBeUndefined();
    expect(probe.readError).toBeDefined();
    expect(probe.processType).toBe("undefined");
    expect(JSON.stringify(probe)).not.toContain("db-key-material");
  }, 30_000);

  it("reports a connection failure as requestError", async () => {
    const dead = options([]);
    dead.collection.item[0].request.url = "http://127.0.0.1:1/never";
    const { execution } = await runNewmanInSandbox(dead);
    expect(execution.requestError?.code).toBeDefined();
  }, 30_000);
});
