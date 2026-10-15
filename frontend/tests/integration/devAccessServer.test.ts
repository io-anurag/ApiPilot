// @vitest-environment node
/**
 * Integration coverage for specs/049-lan-dev-access-token: a real Vite dev server with the access
 * plugin on, in front of a stub backend that applies the backend's real `localHostGuard`. Raw
 * `node:http` requests are used so `Host`, `Origin` and `Cookie` can be set freely.
 */
import { createHash, randomBytes } from "node:crypto";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Logger, type ViteDevServer } from "vite";
import { localHostGuard } from "../../../backend/src/security/localHostGuard";
import { apiProxyOptions } from "../../devAccess/apiProxy";
import { devAccessPlugin } from "../../devAccess/devAccessPlugin";
import { resolveListenAddress } from "../../devAccess/listenAddress";
import { ACCESS_COOKIE_NAME, REFUSAL_MESSAGE } from "../../devAccess/accessControl";

const LAN_ORIGIN = "http://192.168.1.50:5173";

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
}

interface StubBackend {
  port: number;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

/** Stands in for the backend: the real `localHostGuard` first, then an echo of what it received. */
async function startStubBackend(): Promise<StubBackend> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const shim = Object.assign(res, {
      status(code: number) {
        res.statusCode = code;
        return shim;
      },
      json(body: unknown) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      },
    });
    localHostGuard(req as never, shim as never, () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface DevServer {
  vite: ViteDevServer;
  port: number;
  token: string;
  notice: string;
  logged: string[];
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const lanInterfaces = () => ({
  eth0: [
    { address: "192.168.1.20", family: "IPv4", internal: false, netmask: "", mac: "", cidr: null },
  ],
}) as never;

async function startDevServer(
  backendPort: number,
  options: { captureNotice?: boolean; guard?: boolean } = {},
): Promise<DevServer> {
  const root = mkdtempSync(path.join(os.tmpdir(), "apipilot-dev-access-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "index.html"), "<!doctype html><title>app</title><p>SECRET-APP-SHELL</p>");
  const logged: string[] = [];
  const record = (message: string) => void logged.push(message);
  const logger: Logger = {
    hasWarned: false,
    info: record,
    warn: record,
    warnOnce: record,
    error: record,
    clearScreen: () => undefined,
    hasErrorLogged: () => false,
  };
  const noticeParts: string[] = [];
  const vite = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(root, ".vite"),
    customLogger: logger,
    optimizeDeps: { noDiscovery: true },
    plugins:
      options.guard === false
        ? []
        : [
            devAccessPlugin({
              backendPort: String(backendPort),
              address: resolveListenAddress("0.0.0.0"),
              interfaces: lanInterfaces,
              ...(options.captureNotice === false
                ? {}
                : { writeNotice: (text) => noticeParts.push(text) }),
            }),
          ],
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: { "/api": apiProxyOptions(String(backendPort)) },
    },
  });
  await vite.listen();
  cleanups.push(async () => {
    await vite.close();
    rmSync(root, { recursive: true, force: true });
  });
  const port = (vite.httpServer?.address() as AddressInfo).port;
  const notice = noticeParts.join("");
  const token = /\?token=([A-Za-z0-9_-]{43})/.exec(notice)?.[1] ?? "";
  return { vite, port, token, notice, logged };
}

async function withBoth(): Promise<{ dev: DevServer; backend: StubBackend }> {
  const backend = await startStubBackend();
  cleanups.push(() => backend.close());
  return { dev: await startDevServer(backend.port), backend };
}

interface Response {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function send(
  port: number,
  method: string,
  url: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const cookieFor = (token: string) => `${ACCESS_COOKIE_NAME}=${token}`;

type UpgradeOutcome = "401" | "upgraded" | "closed";

/** A raw WebSocket handshake in the form Vite's HMR client uses. */
function attemptUpgrade(port: number, headers: http.OutgoingHttpHeaders = {}): Promise<UpgradeOutcome> {
  return new Promise((resolve) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/?token=vite-ws-token",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "vite-hmr",
        ...headers,
      },
    });
    req.on("response", (res) => {
      resolve(res.statusCode === 401 ? "401" : "closed");
      res.resume();
    });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      resolve("upgraded");
    });
    req.on("error", () => resolve("closed"));
    req.end();
  });
}

describe("US1: opening the printed address and using ApiPilot", () => {
  it("prints a ready-to-open address with the token once the server is listening", async () => {
    const { dev } = await withBoth();
    expect(dev.token).toHaveLength(43);
    expect(dev.notice).toContain(`http://192.168.1.20:${dev.port}/?token=${dev.token}`);
  });

  it("exchanges the token for a cookie and removes it from the address", async () => {
    const { dev } = await withBoth();
    const response = await send(dev.port, "GET", `/?token=${dev.token}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/");
    expect(response.headers["cache-control"]).toBe("no-store");
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain(`${ACCESS_COOKIE_NAME}=${dev.token}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toMatch(/Secure|Max-Age|Expires/i);
  });

  it("keeps other query parameters when it removes the token", async () => {
    const { dev } = await withBoth();
    const response = await send(dev.port, "GET", `/workflow?step=2&token=${dev.token}&x=1`);
    expect(response.headers.location).toBe("/workflow?step=2&x=1");
  });

  it("serves the application to a browser that holds the cookie, on reload and in another tab alike", async () => {
    const { dev } = await withBoth();
    for (const url of ["/", "/index.html", "/@vite/client"]) {
      const response = await send(dev.port, "GET", url, { Cookie: cookieFor(dev.token) });
      expect(response.status).toBe(200);
    }
    const page = await send(dev.port, "GET", "/", { Cookie: cookieFor(dev.token) });
    expect(page.body).toContain("SECRET-APP-SHELL");
  });

  it("carries a state-changing request with a network Origin through the backend's unchanged guard (FR-009)", async () => {
    const { dev, backend } = await withBoth();
    const response = await send(dev.port, "POST", "/api/test-generation-workflow", {
      Cookie: `${cookieFor(dev.token)}; theme=dark`,
      Origin: LAN_ORIGIN,
      Host: `192.168.1.20:${dev.port}`,
    });

    expect(response.status).toBe(200);
    expect(backend.requests).toHaveLength(1);
    const seen = backend.requests[0].headers;
    expect(seen.origin).toBe(`http://127.0.0.1:${backend.port}`);
    expect(seen.host).toBe(`127.0.0.1:${backend.port}`);
    expect(seen.cookie).toBe("theme=dark");
    expect(JSON.stringify(seen)).not.toContain(dev.token);
  });

  it("control: without the guard's backend-facing rewrite, the backend's real guard rejects a network Origin", async () => {
    // Shows what the rewrite above prevents. Same server and proxy, no access plugin.
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const dev = await startDevServer(backend.port, { guard: false });

    const response = await send(dev.port, "POST", "/api/test-generation-workflow", { Origin: LAN_ORIGIN });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe("forbidden_host");
    expect(backend.requests).toHaveLength(0);
  });

  it("adds no Origin to a request that had none", async () => {
    const { dev, backend } = await withBoth();
    const response = await send(dev.port, "GET", "/api/health", { Cookie: cookieFor(dev.token) });
    expect(response.status).toBe(200);
    expect(backend.requests[0].headers.origin).toBeUndefined();
    expect(backend.requests[0].headers.cookie).toBeUndefined();
  });

  it("lets a script use the API with the token in a header, and never forwards it to the backend", async () => {
    const { dev, backend } = await withBoth();
    const headers = { "X-ApiPilot-Token": dev.token };

    const read = await send(dev.port, "GET", "/api/health", headers);
    const write = await send(dev.port, "POST", "/api/test-generation-workflow", { ...headers, Origin: LAN_ORIGIN });
    const wrong = await send(dev.port, "GET", "/api/health", { "X-ApiPilot-Token": "wrong" });

    expect(read.status).toBe(200);
    expect(write.status).toBe(200);
    expect(wrong.status).toBe(401);
    expect(backend.requests).toHaveLength(2);
    expect(JSON.stringify(backend.requests)).not.toContain(dev.token);
    expect(backend.requests.every((r) => r.headers["x-apipilot-token"] === undefined)).toBe(true);
  });

  it("leaves the backend's own guard exactly as strict for a direct caller", async () => {
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const direct = await send(backend.port, "POST", "/api/x", { Origin: LAN_ORIGIN });
    expect(direct.status).toBe(403);
    expect(JSON.parse(direct.body).error).toBe("forbidden_host");
    const lanHost = await send(backend.port, "GET", "/api/x", { Host: `192.168.1.20:${backend.port}` });
    expect(lanHost.status).toBe(403);
    expect(backend.requests).toHaveLength(0);
  });
});

describe("US2: anything without the token gets nothing", () => {
  const targets: [string, string][] = [
    ["GET", "/"],
    ["GET", "/index.html"],
    ["GET", "/@vite/client"],
    ["GET", "/src/main.tsx"],
    ["GET", "/api/health"],
    ["POST", "/api/test-generation-workflow"],
    ["DELETE", "/api/test-generation-workflow"],
  ];
  const credentials: [string, (token: string) => { url?: string; cookie?: string }][] = [
    ["no credential", () => ({})],
    ["a wrong token", () => ({ url: "?token=wrong" })],
    ["a truncated token", (token) => ({ url: `?token=${token.slice(1)}` })],
    ["a malformed cookie", () => ({ cookie: "garbage; ;==" })],
    ["a wrong cookie", () => ({ cookie: `${ACCESS_COOKIE_NAME}=${"x".repeat(43)}` })],
  ];

  it.each(targets)("refuses %s %s for every kind of missing or wrong credential, uniformly", async (method, url) => {
    const { dev, backend } = await withBoth();
    const bodies = new Set<string>();
    for (const [, build] of credentials) {
      const credential = build(dev.token);
      const withParam = credential.url && !url.startsWith("/api") ? `${url}${credential.url}` : url;
      const response = await send(dev.port, method, withParam, credential.cookie ? { Cookie: credential.cookie } : {});
      expect(response.status).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain("SECRET-APP-SHELL");
      expect(response.body).not.toContain(dev.token);
      bodies.add(response.body);
    }
    // One body for every reason (FR-007): its form depends only on whether the path is the API.
    expect(bodies.size).toBe(1);
    const [body] = [...bodies];
    if (url.startsWith("/api")) expect(JSON.parse(body)).toEqual({ error: "unauthorized", message: REFUSAL_MESSAGE });
    else expect(body).toBe(REFUSAL_MESSAGE);
    expect(backend.requests).toHaveLength(0);
  });

  it("refuses a wrong token even when a valid cookie is also sent, and a token on a POST", async () => {
    const { dev } = await withBoth();
    expect((await send(dev.port, "GET", "/?token=wrong", { Cookie: cookieFor(dev.token) })).status).toBe(401);
    expect((await send(dev.port, "POST", `/?token=${dev.token}`)).status).toBe(401);
  });

  it("refuses a WebSocket upgrade without the cookie, and does not answer 401 once it has it", async () => {
    const { dev } = await withBoth();
    expect(await attemptUpgrade(dev.port)).toBe("401");
    expect(await attemptUpgrade(dev.port, { Cookie: `${ACCESS_COOKIE_NAME}=wrong` })).toBe("401");
    // With the cookie the guard steps aside; Vite's own handshake rules then decide.
    expect(await attemptUpgrade(dev.port, { Cookie: cookieFor(dev.token) })).not.toBe("401");
  });

  it("refuses a request from the machine's own loopback address like any other (FR-013)", async () => {
    const { dev } = await withBoth();
    // Every request in this file comes from 127.0.0.1; this one is refused all the same.
    expect((await send(dev.port, "GET", "/")).status).toBe(401);
  });

  it("refuses everything a previous launch issued once the server has restarted (FR-012, SC-007)", async () => {
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const first = await startDevServer(backend.port);
    const staleCookie = cookieFor(first.token);
    expect((await send(first.port, "GET", "/", { Cookie: staleCookie })).status).toBe(200);
    await first.vite.close();

    const second = await startDevServer(backend.port);
    expect(second.token).not.toBe(first.token);
    expect((await send(second.port, "GET", "/", { Cookie: staleCookie })).status).toBe(401);
    expect((await send(second.port, "GET", `/?token=${first.token}`)).status).toBe(401);
    expect((await send(second.port, "GET", "/", { Cookie: cookieFor(second.token) })).status).toBe(200);
  });

  it("sends the same refusal for a stale credential as for none, pointing to the terminal", async () => {
    const { dev } = await withBoth();
    const none = await send(dev.port, "GET", "/");
    const stale = await send(dev.port, "GET", "/", { Cookie: `${ACCESS_COOKIE_NAME}=${createHash("sha256").update("old").digest("base64url")}` });
    expect(stale.body).toBe(none.body);
    expect(none.body).toMatch(/address printed in the terminal/);
  });
});

describe("US2: the token never leaks (FR-008, SC-005)", () => {
  it("appears only in the notice and nowhere else across a full session", async () => {
    const { dev, backend } = await withBoth();
    await send(dev.port, "GET", `/?token=${dev.token}`);
    await send(dev.port, "GET", "/", { Cookie: cookieFor(dev.token) });
    await send(dev.port, "POST", "/api/x", { Cookie: cookieFor(dev.token), Origin: LAN_ORIGIN });
    await send(dev.port, "GET", "/api/x");
    await send(dev.port, "GET", `/?token=${"y".repeat(43)}`);

    // Once as the address to open and once in the script example, both inside the one notice.
    expect(dev.notice.split(dev.token).length - 1).toBe(2);
    expect(dev.logged.join("\n")).not.toContain(dev.token);
    expect(JSON.stringify(backend.requests)).not.toContain(dev.token);
  });

  it("writes the notice to the terminal's stdout, not to Vite's logger", async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    cleanups.push(() => spy.mockRestore());
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const dev = await startDevServer(backend.port, { captureNotice: false });

    const stdout = written.join("");
    const token = /\?token=([A-Za-z0-9_-]{43})/.exec(stdout)?.[1];
    expect(token).toBeDefined();
    expect(dev.logged.join("\n")).not.toContain(token as string);
    // Only the notice (the address and the script example inside it) carries the token.
    expect(stdout.split(token as string).length - 1).toBe(2);
  });
});
