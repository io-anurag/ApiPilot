import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFetchSender, READ_CAP_BYTES, type SendInput } from "../../../../../src/performance/chain/debug/sender";

/** AP-039 (specs/039-chain-debug-run tasks T015; research R4). Local servers only: no network. */

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const seenA: Seen[] = [];
const seenB: Seen[] = [];

function serverOf(seen: Seen[], handler: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf-8") });
      handler(req, res, url);
    });
  });
}

let a: http.Server;
let b: http.Server;
let baseA = "";
let baseB = "";

beforeAll(async () => {
  b = serverOf(seenB, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("on b");
  });
  a = serverOf(seenA, (_req, res, url) => {
    if (url.pathname === "/json") {
      res.writeHead(200, { "Content-Type": "application/json", "X-Thing": "1" });
      res.end('{"ok":true}');
    } else if (url.pathname === "/r1") {
      res.writeHead(302, { Location: "/r2" });
      res.end();
    } else if (url.pathname === "/r2") {
      res.writeHead(302, { Location: "/json" });
      res.end();
    } else if (url.pathname === "/post-303") {
      res.writeHead(303, { Location: "/json" });
      res.end();
    } else if (url.pathname === "/to-b") {
      res.writeHead(302, { Location: `${baseB}/landing` });
      res.end();
    } else if (url.pathname === "/to-evil") {
      res.writeHead(302, { Location: "http://evil.example.test:9/x" });
      res.end("moved");
    } else if (url.pathname === "/loop") {
      res.writeHead(302, { Location: "/loop" });
      res.end();
    } else if (url.pathname === "/big") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(Buffer.alloc(READ_CAP_BYTES + 1000, 97));
    } else if (url.pathname === "/hang") {
      // never answers; the client's deadline or abort ends it
    } else {
      res.writeHead(404);
      res.end("none");
    }
  });
  await new Promise<void>((resolve) => a.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => b.listen(0, "127.0.0.1", resolve));
  baseA = `http://127.0.0.1:${(a.address() as AddressInfo).port}`;
  baseB = `http://127.0.0.1:${(b.address() as AddressInfo).port}`;
});

afterAll(async () => {
  a.closeAllConnections();
  b.closeAllConnections();
  await new Promise((resolve) => a.close(resolve));
  await new Promise((resolve) => b.close(resolve));
});

const sender = createFetchSender();

function input(overrides: Partial<SendInput> & { url: string }): SendInput {
  return { method: "GET", headers: {}, body: null, timeoutMs: 5000, signal: new AbortController().signal, allowUrl: (url) => url.origin === baseA || url.origin === baseB, ...overrides };
}

describe("the Debug run sender", () => {
  it("sends the method, headers and body and returns status, headers and body bytes", async () => {
    const result = await sender.send(input({ method: "POST", url: `${baseA}/json`, headers: { "X-Test": "yes", "Content-Type": "text/plain" }, body: "hello" }));
    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/json");
    expect(new TextDecoder().decode(result.body)).toBe('{"ok":true}');
    expect(Object.fromEntries(result.headers)["x-thing"]).toBe("1");
    expect(result.bodyTruncated).toBe(false);
    const request = seenA.at(-1)!;
    expect([request.method, request.body, request.headers["x-test"]]).toEqual(["POST", "hello", "yes"]);
  });

  it("follows redirects and lists each URL followed", async () => {
    const result = await sender.send(input({ url: `${baseA}/r1` }));
    expect(result.kind === "response" && result.status).toBe(200);
    expect(result.redirects).toEqual([`${baseA}/r2`, `${baseA}/json`]);
  });

  it("turns a 303 into a GET without the body", async () => {
    await sender.send(input({ method: "POST", url: `${baseA}/post-303`, body: "payload", headers: { "Content-Type": "text/plain" } }));
    expect(seenA.filter((entry) => entry.url === "/post-303").at(-1)!.method).toBe("POST");
    const followed = seenA.filter((entry) => entry.url === "/json").at(-1)!;
    expect([followed.method, followed.body]).toEqual(["GET", ""]);
  });

  it("does not send Authorization to another origin it was redirected to, and still allows that origin", async () => {
    const result = await sender.send(input({ url: `${baseA}/to-b`, headers: { Authorization: "Bearer abc" } }));
    expect(result.kind === "response" && new TextDecoder().decode(result.body)).toBe("on b");
    expect(seenA.filter((entry) => entry.url === "/to-b").at(-1)!.headers.authorization).toBe("Bearer abc");
    expect(seenB.at(-1)!.headers.authorization).toBeUndefined();
  });

  it("does not follow a redirect to a host that is not allowed and reports the redirect response and the host", async () => {
    const result = await sender.send(input({ url: `${baseA}/to-evil` }));
    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.status).toBe(302);
    expect(result.redirectBlockedTo).toBe("evil.example.test:9");
    expect(new TextDecoder().decode(result.body)).toBe("moved");
  });

  it("stops following after 10 redirects and returns the last redirect response", async () => {
    const result = await sender.send(input({ url: `${baseA}/loop` }));
    expect(result.kind === "response" && result.status).toBe(302);
    expect(result.redirects).toHaveLength(10);
  });

  it("reads at most the cap and says the body was cut", async () => {
    const result = await sender.send(input({ url: `${baseA}/big` }));
    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.body.length).toBe(READ_CAP_BYTES);
    expect(result.bodyTruncated).toBe(true);
  });

  it("reports a refused connection", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const result = await sender.send(input({ url: `http://127.0.0.1:${port}/`, allowUrl: () => true }));
    expect(result).toMatchObject({ kind: "no-response", reason: "refused" });
  });

  it("reports a timeout", async () => {
    const result = await sender.send(input({ url: `${baseA}/hang`, timeoutMs: 150 }));
    expect(result).toMatchObject({ kind: "no-response", reason: "timeout" });
  });

  it("reports an abort by the caller as aborted, not as a timeout", async () => {
    const controller = new AbortController();
    const pending = sender.send(input({ url: `${baseA}/hang`, signal: controller.signal }));
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toMatchObject({ kind: "no-response", reason: "aborted" });
  });

  it("says a request with a body on GET cannot be sent, and sends nothing", async () => {
    const before = seenA.length;
    const result = await sender.send(input({ method: "GET", url: `${baseA}/json`, body: "x" }));
    expect(result).toMatchObject({ kind: "no-response", reason: "unsupported-request" });
    expect(seenA).toHaveLength(before);
  });
});
