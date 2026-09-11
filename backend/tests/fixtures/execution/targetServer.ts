import express from "express";
import type { Server } from "node:http";

/** One request the target server actually received, for tests to assert against. */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** Canned behavior for one `METHOD path` this server should respond to. */
export interface RouteConfig {
  status?: number;
  body?: unknown;
  /** Delays the response by this many milliseconds — exercises pacing/timeout/cancellation. */
  delayMs?: number;
}

/**
 * A small local HTTP server standing in for "the target API" in execution integration tests
 * (constitution XXI — no test may depend on real external network access). Requests are recorded
 * for assertions, and per-route status/body/delay can be configured; anything unconfigured
 * defaults to `200 {}`.
 */
export class TargetServer {
  readonly requests: RecordedRequest[] = [];
  private readonly app = express();
  private readonly routes = new Map<string, RouteConfig>();
  private server: Server | undefined;
  private port = 0;

  constructor() {
    this.app.use(express.json());
    this.app.use((req, res) => {
      this.requests.push({
        method: req.method,
        path: req.path,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: req.body,
      });
      const config = this.routes.get(`${req.method.toUpperCase()} ${req.path}`);
      const status = config?.status ?? 200;
      const body = config?.body ?? {};
      const respond = () => res.status(status).json(body);
      if (config?.delayMs) {
        setTimeout(respond, config.delayMs);
      } else {
        respond();
      }
    });
  }

  /** Configures how this server responds to one `method path` pair (e.g. `"POST", "/pets"`). */
  configure(method: string, path: string, config: RouteConfig): void {
    this.routes.set(`${method.toUpperCase()} ${path}`, config);
  }

  /** Starts listening on an OS-assigned local port and returns its base URL. */
  async start(): Promise<string> {
    await new Promise<void>((resolve) => {
      this.server = this.app.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server!.address();
    this.port = typeof address === "object" && address !== null ? address.port : 0;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}
