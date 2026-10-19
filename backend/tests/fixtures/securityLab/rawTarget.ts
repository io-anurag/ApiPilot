import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

/** One request a raw target actually received. */
export interface RawRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export type RawHandler = (request: RawRequest, response: http.ServerResponse) => void;

/**
 * A loopback HTTP or HTTPS server with a raw handler, for tests that need exact control over redirects, delays,
 * body sizes and headers (the guarded sender, the run service). It records every request it receives, so a test can
 * prove that a blocked request never reached it. Listens on 127.0.0.1 only; no test touches a public network.
 */
export class RawTarget {
  readonly requests: RawRequest[] = [];
  private server: http.Server | https.Server | undefined;
  private port = 0;
  private scheme: "http" | "https" = "http";
  private readonly sockets = new Set<import("node:net").Socket>();

  constructor(private handler: RawHandler) {}

  setHandler(handler: RawHandler): void {
    this.handler = handler;
  }

  /** Starts listening on `port` (an OS-assigned one by default) and returns the origin. */
  async start(tls?: { key: string; cert: string }, port = 0): Promise<string> {
    const onRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const recorded: RawRequest = { method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf8") };
        this.requests.push(recorded);
        this.handler(recorded, response);
      });
    };
    this.scheme = tls ? "https" : "http";
    this.server = tls ? https.createServer(tls, onRequest) : http.createServer(onRequest);
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) => this.server?.listen(port, "127.0.0.1", resolve));
    const address = this.server.address();
    this.port = typeof address === "object" && address !== null ? address.port : 0;
    return this.origin;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  get portNumber(): number {
    return this.port;
  }

  get origin(): string {
    return `${this.scheme}://127.0.0.1:${this.port}`;
  }
}

/** True when the `openssl` command line is available to make a throwaway test certificate. */
export function opensslAvailable(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * A throwaway self-signed certificate for 127.0.0.1, generated for one test run and deleted at once, so the
 * repository carries no private key. Returns the PEM text.
 */
export function makeSelfSignedCertificate(): { key: string; cert: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "sl-cert-"));
  try {
    const keyFile = path.join(directory, "key.pem");
    const certFile = path.join(directory, "cert.pem");
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
      { stdio: "ignore" },
    );
    return { key: readFileSync(keyFile, "utf8"), cert: readFileSync(certFile, "utf8") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
