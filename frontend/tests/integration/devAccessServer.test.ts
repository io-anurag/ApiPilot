// @vitest-environment node
/**
 * Integration coverage for specs/060-per-device-dev-access: a real Vite dev server with the access
 * plugin on, in front of a stub backend that applies the backend's real `localHostGuard`. Raw
 * `node:http` requests are used so `Host`, `Origin` and `Cookie` can be set freely. The client
 * address the plugin sees is injectable, so address binding can be tested from one machine.
 */
import { randomBytes } from "node:crypto";
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
import {
  ACCESS_COOKIE_NAME,
  ENROLL_PATH,
  REFUSAL_MESSAGE,
} from "../../devAccess/accessControl";

const LAN_HOST = "192.168.1.50:5173";
const LAN_ORIGIN = `http://${LAN_HOST}`;

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
  notice: string;
  logged: string[];
  /** Changes the client address the plugin sees for every later request. */
  setClient: (address: string) => void;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const lanInterfaces = () =>
  ({
    eth0: [
      {
        address: "192.168.1.20",
        family: "IPv4",
        internal: false,
        netmask: "",
        mac: "",
        cidr: null,
      },
    ],
  }) as never;

async function startDevServer(
  backendPort: number,
  options: { captureNotice?: boolean; guard?: boolean } = {},
): Promise<DevServer> {
  const root = mkdtempSync(path.join(os.tmpdir(), "apipilot-dev-access-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "index.html"),
    "<!doctype html><title>app</title><p>SECRET-APP-SHELL</p>",
  );
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
  let client = "192.168.1.30";
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
              clientAddress: () => client,
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
  return {
    vite,
    port,
    notice: noticeParts.join(""),
    logged,
    setClient: (address) => {
      client = address;
    },
  };
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
    const req = http.request(
      { host: "127.0.0.1", port, method, path: url, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const BROWSER_NAVIGATION = {
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Site": "none",
};

/** A browser opening the address: the page loads and the session cookie arrives with it. */
async function enrolBrowser(dev: DevServer): Promise<string> {
  const response = await send(dev.port, "GET", "/", BROWSER_NAVIGATION);
  expect(response.status).toBe(200);
  expect(response.body).toContain("SECRET-APP-SHELL");
  const match = new RegExp(`${ACCESS_COOKIE_NAME}=([A-Za-z0-9_-]{43})`).exec(
    String(response.headers["set-cookie"]),
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

/** A script asking for its token as JSON. */
async function enrolScript(dev: DevServer): Promise<string> {
  const response = await send(dev.port, "POST", ENROLL_PATH, {
    Accept: "application/json",
  });
  expect(response.status).toBe(201);
  return (JSON.parse(response.body) as { token: string }).token;
}

const cookieFor = (token: string) => `${ACCESS_COOKIE_NAME}=${token}`;

type UpgradeOutcome = "401" | "upgraded" | "closed";

/** A raw WebSocket handshake in the form Vite's HMR client uses. */
function attemptUpgrade(
  port: number,
  headers: http.OutgoingHttpHeaders = {},
): Promise<UpgradeOutcome> {
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

describe("US1: a user gets their own access and uses ApiPilot", () => {
  it("prints the addresses to open once the server is listening, with no token", async () => {
    const { dev } = await withBoth();
    expect(dev.notice).toContain(`http://192.168.1.20:${dev.port}/\n`);
    expect(dev.notice).toContain("given its own token automatically");
    expect(dev.notice).not.toContain("token=");
  });

  it("opens the application for a browser page load with no credential, with no step in between", async () => {
    const { dev } = await withBoth();
    const page = await send(dev.port, "GET", "/", BROWSER_NAVIGATION);
    expect(page.status).toBe(200);
    expect(page.body).toContain("SECRET-APP-SHELL");
  });

  it("issues a session cookie that scripts cannot read, with the page", async () => {
    const { dev } = await withBoth();
    const response = await send(dev.port, "GET", "/", BROWSER_NAVIGATION);
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toMatch(/Secure|Max-Age|Expires/i);
  });

  it("lets a user open an API address in the browser and use the browser's own token", async () => {
    const { dev, backend } = await withBoth();
    const first = await send(dev.port, "GET", "/api/health", BROWSER_NAVIGATION);
    expect(first.status).toBe(200);
    const token = new RegExp(`${ACCESS_COOKIE_NAME}=([A-Za-z0-9_-]{43})`).exec(
      String(first.headers["set-cookie"]),
    )?.[1];
    expect(token).toBeDefined();
    const again = await send(dev.port, "GET", "/api/health", {
      Cookie: cookieFor(token ?? ""),
    });
    expect(again.status).toBe(200);
    expect(JSON.stringify(backend.requests)).not.toContain(token);
  });

  it("does not issue a token to a cross-site page load or to a script that does not ask for HTML", async () => {
    const { dev } = await withBoth();
    const crossSite = await send(dev.port, "GET", "/", {
      ...BROWSER_NAVIGATION,
      "Sec-Fetch-Site": "cross-site",
    });
    const script = await send(dev.port, "GET", "/api/health", {
      Accept: "application/json",
    });
    for (const response of [crossSite, script]) {
      expect(response.status).toBe(401);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("does not issue a token to a page load from outside the private networks", async () => {
    const { dev } = await withBoth();
    dev.setClient("203.0.113.9");
    const response = await send(dev.port, "GET", "/", BROWSER_NAVIGATION);
    expect(response.status).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body).not.toContain("SECRET-APP-SHELL");
  });

  it("serves the application to an enrolled browser, on reload and in another tab alike", async () => {
    const { dev } = await withBoth();
    const token = await enrolBrowser(dev);
    for (const url of ["/", "/index.html", "/@vite/client"]) {
      const response = await send(dev.port, "GET", url, { Cookie: cookieFor(token) });
      expect(response.status).toBe(200);
    }
    const page = await send(dev.port, "GET", "/", { Cookie: cookieFor(token) });
    expect(page.body).toContain("SECRET-APP-SHELL");
  });

  it("gives every user a different token", async () => {
    const { dev } = await withBoth();
    const first = await enrolBrowser(dev);
    const second = await enrolBrowser(dev);
    expect(first).not.toBe(second);
  });

  it("carries a state-changing request with a network Origin through the backend's unchanged guard (FR-010)", async () => {
    const { dev, backend } = await withBoth();
    const token = await enrolBrowser(dev);
    const response = await send(dev.port, "POST", "/api/test-generation-workflow", {
      Cookie: `${cookieFor(token)}; theme=dark`,
      Origin: LAN_ORIGIN,
      Host: `192.168.1.20:${dev.port}`,
    });

    expect(response.status).toBe(200);
    expect(backend.requests).toHaveLength(1);
    const seen = backend.requests[0].headers;
    expect(seen.origin).toBe(`http://127.0.0.1:${backend.port}`);
    expect(seen.host).toBe(`127.0.0.1:${backend.port}`);
    expect(seen.cookie).toBe("theme=dark");
    expect(JSON.stringify(seen)).not.toContain(token);
  });

  it("control: without the guard's backend-facing rewrite, the backend's real guard rejects a network Origin", async () => {
    // Shows what the rewrite above prevents. Same server and proxy, no access plugin.
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const dev = await startDevServer(backend.port, { guard: false });

    const response = await send(dev.port, "POST", "/api/test-generation-workflow", {
      Origin: LAN_ORIGIN,
    });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe("forbidden_host");
    expect(backend.requests).toHaveLength(0);
  });

  it("adds no Origin to a request that had none", async () => {
    const { dev, backend } = await withBoth();
    const token = await enrolBrowser(dev);
    const response = await send(dev.port, "GET", "/api/health", {
      Cookie: cookieFor(token),
    });
    expect(response.status).toBe(200);
    expect(backend.requests[0].headers.origin).toBeUndefined();
    expect(backend.requests[0].headers.cookie).toBeUndefined();
  });

  it("lets a script enrol for JSON, use the API with the token in a header, and never forwards it", async () => {
    const { dev, backend } = await withBoth();
    const token = await enrolScript(dev);
    const headers = { "X-ApiPilot-Token": token };

    const read = await send(dev.port, "GET", "/api/health", headers);
    const write = await send(dev.port, "POST", "/api/test-generation-workflow", {
      ...headers,
      Origin: LAN_ORIGIN,
    });
    const wrong = await send(dev.port, "GET", "/api/health", {
      "X-ApiPilot-Token": "wrong",
    });

    expect(read.status).toBe(200);
    expect(write.status).toBe(200);
    expect(wrong.status).toBe(401);
    expect(backend.requests).toHaveLength(2);
    expect(JSON.stringify(backend.requests)).not.toContain(token);
    expect(
      backend.requests.every((r) => r.headers["x-apipilot-token"] === undefined),
    ).toBe(true);
  });

  it("leaves the backend's own guard exactly as strict for a direct caller", async () => {
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const direct = await send(backend.port, "POST", "/api/x", { Origin: LAN_ORIGIN });
    expect(direct.status).toBe(403);
    expect(JSON.parse(direct.body).error).toBe("forbidden_host");
    const lanHost = await send(backend.port, "GET", "/api/x", {
      Host: `192.168.1.20:${backend.port}`,
    });
    expect(lanHost.status).toBe(403);
    expect(backend.requests).toHaveLength(0);
  });
});

describe("US2: a token works only on the system it was issued to", () => {
  it("refuses a token from another address, by cookie, by header and on a WebSocket upgrade", async () => {
    const { dev, backend } = await withBoth();
    const token = await enrolBrowser(dev);
    expect((await send(dev.port, "GET", "/", { Cookie: cookieFor(token) })).status).toBe(
      200,
    );

    dev.setClient("192.168.1.31");

    expect((await send(dev.port, "GET", "/", { Cookie: cookieFor(token) })).status).toBe(
      401,
    );
    expect(
      (await send(dev.port, "GET", "/api/health", { "X-ApiPilot-Token": token })).status,
    ).toBe(401);
    expect(await attemptUpgrade(dev.port, { Cookie: cookieFor(token) })).toBe("401");
    expect(backend.requests).toHaveLength(0);

    dev.setClient("192.168.1.30");
    expect((await send(dev.port, "GET", "/", { Cookie: cookieFor(token) })).status).toBe(
      200,
    );
  });

  it("refuses to enrol an address outside the private networks, and issues no token", async () => {
    const { dev } = await withBoth();
    dev.setClient("203.0.113.9");
    const response = await send(dev.port, "POST", ENROLL_PATH, {
      Accept: "application/json",
    });
    expect(response.status).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body).not.toMatch(/token/i);
  });

  it("refuses to enrol a request that comes from another origin", async () => {
    const { dev } = await withBoth();
    const response = await send(dev.port, "POST", ENROLL_PATH, {
      Origin: "http://evil.example",
      Accept: "text/html",
    });
    expect(response.status).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("accepts enrolment from the dev server's own origin", async () => {
    const { dev } = await withBoth();
    const response = await send(dev.port, "POST", ENROLL_PATH, {
      Origin: LAN_ORIGIN,
      Host: LAN_HOST,
    });
    expect(response.status).toBe(201);
  });

  it("does not enrol on a GET", async () => {
    const { dev } = await withBoth();
    const response = await send(dev.port, "GET", ENROLL_PATH);
    expect(response.status).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("ignores a forwarding header when it decides the client address", async () => {
    const { dev } = await withBoth();
    dev.setClient("203.0.113.9");
    const response = await send(dev.port, "POST", ENROLL_PATH, {
      "X-Forwarded-For": "192.168.1.30",
    });
    expect(response.status).toBe(403);
  });

  it("refuses everything a previous launch issued once the server has restarted (SC-002)", async () => {
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const first = await startDevServer(backend.port);
    const token = await enrolBrowser(first);
    expect(
      (await send(first.port, "GET", "/", { Cookie: cookieFor(token) })).status,
    ).toBe(200);
    await first.vite.close();

    const second = await startDevServer(backend.port);
    expect(
      (await send(second.port, "GET", "/", { Cookie: cookieFor(token) })).status,
    ).toBe(401);
    const fresh = await enrolBrowser(second);
    expect(
      (await send(second.port, "GET", "/", { Cookie: cookieFor(fresh) })).status,
    ).toBe(200);
  });
});

describe("US2: anything without a valid token gets nothing", () => {
  const targets: [string, string][] = [
    ["GET", "/"],
    ["GET", "/index.html"],
    ["GET", "/@vite/client"],
    ["GET", "/src/main.tsx"],
    ["GET", "/api/health"],
    ["POST", "/api/test-generation-workflow"],
    ["DELETE", "/api/test-generation-workflow"],
  ];
  const credentials: [string, string | undefined][] = [
    ["no credential", undefined],
    ["a malformed cookie", "garbage; ;=="],
    ["a wrong cookie", `${ACCESS_COOKIE_NAME}=${"x".repeat(43)}`],
  ];

  it.each(targets)(
    "refuses %s %s for every kind of missing or wrong credential, uniformly",
    async (method, url) => {
      const { dev, backend } = await withBoth();
      const bodies = new Set<string>();
      for (const [, cookie] of credentials) {
        const response = await send(
          dev.port,
          method,
          url,
          cookie ? { Cookie: cookie } : {},
        );
        expect(response.status).toBe(401);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).not.toContain("SECRET-APP-SHELL");
        bodies.add(response.body);
      }
      // One body for every reason (FR-007): its form depends only on whether the path is the API.
      expect(bodies.size).toBe(1);
      const [body] = [...bodies];
      if (url.startsWith("/api"))
        expect(JSON.parse(body)).toEqual({
          error: "unauthorized",
          message: REFUSAL_MESSAGE,
        });
      else expect(body).toContain(REFUSAL_MESSAGE);
      expect(backend.requests).toHaveLength(0);
    },
  );

  it("does not honour a token query parameter", async () => {
    const { dev } = await withBoth();
    const token = await enrolScript(dev);
    expect((await send(dev.port, "GET", `/?token=${token}`)).status).toBe(401);
    expect((await send(dev.port, "GET", `/api/health?token=${token}`)).status).toBe(401);
  });

  it("refuses a WebSocket upgrade without a valid credential, and does not answer 401 once it has one", async () => {
    const { dev } = await withBoth();
    expect(await attemptUpgrade(dev.port)).toBe("401");
    expect(
      await attemptUpgrade(dev.port, { Cookie: `${ACCESS_COOKIE_NAME}=wrong` }),
    ).toBe("401");
    const token = await enrolBrowser(dev);
    // With the cookie the guard steps aside; Vite's own handshake rules then decide.
    expect(await attemptUpgrade(dev.port, { Cookie: cookieFor(token) })).not.toBe("401");
  });

  it("refuses a request from the machine's own loopback address like any other", async () => {
    const { dev } = await withBoth();
    dev.setClient("127.0.0.1");
    expect((await send(dev.port, "GET", "/")).status).toBe(401);
  });
});

describe("US1: no token is ever shown (FR-002, SC-004)", () => {
  it("appears only in the enrolment response, never in a log, the notice or what the backend sees", async () => {
    const { dev, backend } = await withBoth();
    const token = await enrolBrowser(dev);
    await send(dev.port, "GET", "/", { Cookie: cookieFor(token) });
    await send(dev.port, "POST", "/api/x", {
      Cookie: cookieFor(token),
      Origin: LAN_ORIGIN,
    });
    await send(dev.port, "GET", "/api/x");

    expect(dev.notice).not.toContain(token);
    expect(dev.logged.join("\n")).not.toContain(token);
    expect(JSON.stringify(backend.requests)).not.toContain(token);
  });

  it("writes the notice to the terminal's stdout, not to Vite's logger", async () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    cleanups.push(() => spy.mockRestore());
    const backend = await startStubBackend();
    cleanups.push(() => backend.close());
    const dev = await startDevServer(backend.port, { captureNotice: false });

    expect(written.join("")).toContain("given its own token automatically");
    expect(dev.logged.join("\n")).not.toContain("given its own token automatically");
  });
});
