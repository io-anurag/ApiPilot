import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { RawTarget, type RawHandler, type RawRequest } from "./rawTarget";
import { ALICE_KEY, ALICE_TOKEN, BOB_KEY, BOB_TOKEN } from "./fixtureCredentials";

/**
 * Loopback stand-ins for "the target API" of the sample specification (specs/057 T103). The **secure** target does
 * what a well-built service does; the **vulnerable** one deliberately breaks the controls Security Lab checks, so an
 * end-to-end run can tell them apart. Both are plain `node:http` handlers over `RawTarget`, record every request, and
 * never leave 127.0.0.1.
 */

export interface TargetBehavior {
  /** Answers a request without credentials on read operations, and lets any identity read any order. */
  vulnerable?: boolean;
  /** Makes `DELETE /orders/:id` fail, so a run's cleanup failure can be observed. */
  failDelete?: boolean;
  /** Makes `GET /redirect-evil` redirect to a host the profile does not allow. */
  evilRedirectTo?: string;
}

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
};

type Caller = "alice" | "bob" | "admin" | undefined;

function callerOf(headers: IncomingHttpHeaders): Caller {
  const authorization = headers.authorization ?? "";
  if (authorization === `Bearer ${ALICE_TOKEN}`) return "alice";
  if (authorization === `Bearer ${BOB_TOKEN}`) return "bob";
  const key = headers["x-api-key"];
  if (key === ALICE_KEY || key === BOB_KEY) return "admin";
  return undefined;
}

const STATUSES = new Set(["open", "shipped", "cancelled"]);

/** The behavior of a sample API: orders are owned by alice, ids are `o-<n>`, and a stack trace is the vulnerable one's error body. */
export function sampleHandler(behavior: TargetBehavior = {}): RawHandler {
  let created = 0;
  return (request: RawRequest, response: ServerResponse) => {
    const url = new URL(request.url, "http://target.test");
    const caller = callerOf(request.headers);
    const unauthorized = () => json(response, 401, { message: "unauthorized" }, { "www-authenticate": "Bearer" });

    if (url.pathname === "/redirect-evil" && behavior.evilRedirectTo) {
      response.writeHead(302, { location: behavior.evilRedirectTo }).end();
      return;
    }
    if (["HEAD", "OPTIONS", "TRACE"].includes(request.method)) {
      response.writeHead(behavior.vulnerable ? 200 : 405).end();
      return;
    }
    if (url.pathname === "/public/status") return json(response, 200, { up: true });

    const needsAuth = !(behavior.vulnerable && request.method === "GET");
    if (needsAuth && !caller) return unauthorized();

    if (url.pathname === "/orders" && request.method === "GET") return json(response, 200, [{ id: "ord-1001", status: "open", total: 5 }], { "x-ratelimit-limit": "30" });

    if (url.pathname === "/orders" && request.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(request.body) as Record<string, unknown>;
      } catch {
        return json(response, behavior.vulnerable ? 500 : 400, behavior.vulnerable ? { message: "SyntaxError: Unexpected token\n    at JSON.parse (<anonymous>)\n    at Object.handler (/srv/app/server.js:42:13)" } : { message: "invalid body" });
      }
      const valid = typeof body.status === "string" && STATUSES.has(body.status) && (body.total === undefined || (typeof body.total === "number" && body.total >= 0));
      if (!valid && !behavior.vulnerable) return json(response, 400, { message: "invalid order" });
      created += 1;
      return json(response, 201, { id: `o-${created}`, status: body.status ?? "open", ...(typeof body.id === "string" && behavior.vulnerable ? { id: body.id } : {}) });
    }

    const order = /^\/orders\/([^/]+)$/.exec(url.pathname);
    if (order) {
      const owner = order[1] === "ord-1001" ? "alice" : undefined;
      const allowed = behavior.vulnerable || caller === "admin" || caller === owner || owner === undefined;
      if (!allowed) return json(response, 403, { message: "forbidden" });
      if (request.method === "GET") return json(response, 200, { id: order[1], status: "open" });
      if (request.method === "PUT") return json(response, 200, { id: order[1], status: "open" });
      if (request.method === "DELETE") {
        if (behavior.failDelete) return json(response, 500, { message: "delete failed" });
        response.writeHead(204).end();
        return;
      }
    }
    if (url.pathname === "/admin/reports") return caller === "admin" || behavior.vulnerable ? json(response, 200, { reports: [] }) : unauthorized();
    json(response, 404, { message: "not found" });
  };
}

export async function startSampleTarget(behavior: TargetBehavior = {}, port = 0): Promise<RawTarget> {
  const target = new RawTarget(sampleHandler(behavior));
  await target.start(undefined, port);
  return target;
}
