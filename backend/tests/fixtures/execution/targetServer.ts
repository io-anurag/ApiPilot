import express from "express";
import type { Server } from "node:http";

/** One request the target server actually received, for tests to assert against. */
export interface RecordedRequest {
  method: string;
  path: string;
  /** The raw query string after `?`, or `""`, so a test sees exactly what was sent. */
  query: string;
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
 * AP-035 (specs/035-user-defined-journeys tasks T004): a computed response, for a stateful target.
 * Consulted before the configured routes; returning `undefined` falls through to them.
 */
export type RequestHandler = (
  request: RecordedRequest,
) => { status: number; body?: unknown; headers?: Record<string, string>; delayMs?: number } | undefined;

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
  private handler: RequestHandler | undefined;
  private server: Server | undefined;
  private port = 0;

  constructor() {
    this.app.use(express.json());
    this.app.use((req, res) => {
      const recorded: RecordedRequest = {
        method: req.method,
        path: req.path,
        query: req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "",
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: req.body,
      };
      this.requests.push(recorded);
      const handled = this.handler?.(recorded);
      if (handled) {
        const send = () => {
          for (const [name, value] of Object.entries(handled.headers ?? {})) res.setHeader(name, value);
          if (handled.body === undefined) res.status(handled.status).end();
          else res.status(handled.status).json(handled.body);
        };
        // AP-037: a computed response may be delayed, for per-step response-time checks.
        if (handled.delayMs) setTimeout(send, handled.delayMs);
        else send();
        return;
      }
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

  /** AP-035: computes responses before the configured routes (see `RequestHandler`). */
  handle(handler: RequestHandler): void {
    this.handler = handler;
  }

  /**
   * Starts listening on `port` (an OS-assigned local port by default) and returns its base URL.
   * AP-029's manual stub target (`npm run perf:stub -w backend`) passes a fixed port.
   */
  async start(port = 0): Promise<string> {
    await new Promise<void>((resolve) => {
      this.server = this.app.listen(port, "127.0.0.1", resolve);
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
