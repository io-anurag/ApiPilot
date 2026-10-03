import type { RequestHandler } from "./targetServer";

/**
 * AP-035 (specs/035-user-defined-journeys tasks T004, quickstart 3 and 4): a stateful customers API
 * for `tests/fixtures/openapi/user-journeys.yaml`. Each `POST /api/v1/customers` issues a new id from
 * a counter (never random) with a `Location` header; `GET`, `PUT` and `DELETE` of an id never issued,
 * or already deleted, answer 404. With `dropIdEvery: n`, every n-th create omits `id` from its body.
 * Counts are kept by route and never record an id.
 *
 * AP-036 (specs/036-collection-performance-test tasks T004, quickstart Prerequisites): with `auth`,
 * `POST /auth/token` issues a counter-based bearer token (with `expires_in` when `expiresIn` is set,
 * or answers `tokenStatus` when set), and every customers request without a currently valid issued
 * token answers 401. `PATCH` is handled like `PUT`. With `rejectRepeatedEmail`, a create repeating an
 * earlier email answers 409. `GET /health` and `GET /version` answer 200. Every received create body
 * is kept in `bodies`, for uniqueness checks; tokens and ids are never counted by value.
 *
 * AP-037 (specs/037-request-chain-performance tasks T004, US3): `GET` of one customer answers
 * `{ id, name, status: "ACTIVE" }`. With `wrongIdEvery: n`, every n-th such read answers another id
 * (`wrongIds` counts them); with `slowEvery: n`, every n-th customers response is delayed by `slowMs`
 * (default 600) (`slow` counts them). Both counters follow arrival order, never random.
 */
export interface CustomersTarget {
  handler: RequestHandler;
  counts: {
    creates: number;
    reads: number;
    replaces: number;
    deletes: number;
    notFound: number;
    patches: number;
    conflicts: number;
    tokensIssued: number;
    unauthorized: number;
    /** AP-037: reads answered with another id. */
    wrongIds: number;
    /** AP-037: customers responses delayed by `slowMs`. */
    slow: number;
  };
  /** AP-036: every create body received, in arrival order. */
  bodies: unknown[];
}

export interface CustomersTargetOptions {
  dropIdEvery?: number;
  idPrefix?: string;
  auth?: { expiresIn?: number; tokenStatus?: number };
  rejectRepeatedEmail?: boolean;
  /** AP-037: every n-th single-customer read answers another id. */
  wrongIdEvery?: number;
  /** AP-037: every n-th customers response is delayed by `slowMs`. */
  slowEvery?: number;
  slowMs?: number;
  now?: () => number;
}

const ITEM = /^\/api\/v1\/customers\/([^/]+)$/;
const CUSTOMERS = /^\/api\/v1\/customers(\/|$)/;

export function customersTarget(options: CustomersTargetOptions = {}): CustomersTarget {
  const now = options.now ?? (() => Date.now());
  const live = new Set<string>();
  const emails = new Set<string>();
  const tokens = new Map<string, number>();
  const bodies: unknown[] = [];
  let issued = 0;
  let singleReads = 0;
  let customerResponses = 0;
  const counts = { creates: 0, reads: 0, replaces: 0, deletes: 0, notFound: 0, patches: 0, conflicts: 0, tokensIssued: 0, unauthorized: 0, wrongIds: 0, slow: 0 };

  const authorized = (header: unknown): boolean => {
    if (!options.auth) return true;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
    const expiresAt = tokens.get(header.slice("Bearer ".length));
    return expiresAt !== undefined && expiresAt > now();
  };

  type Handled = ReturnType<RequestHandler>;

  const issueToken = (auth: NonNullable<CustomersTargetOptions["auth"]>): Handled => {
    if (auth.tokenStatus !== undefined) return { status: auth.tokenStatus, body: { error: "token_unavailable" } };
    counts.tokensIssued += 1;
    const token = `stub-token-${counts.tokensIssued}`;
    const lifetimeS = auth.expiresIn;
    tokens.set(token, lifetimeS === undefined ? Number.POSITIVE_INFINITY : now() + lifetimeS * 1000);
    return { status: 200, body: { access_token: token, token_type: "Bearer", ...(lifetimeS === undefined ? {} : { expires_in: lifetimeS }) } };
  };

  const create = (body: unknown): Handled => {
    bodies.push(body);
    const email = (body as { email?: unknown } | undefined)?.email;
    if (options.rejectRepeatedEmail && typeof email === "string") {
      if (emails.has(email)) {
        counts.conflicts += 1;
        return { status: 409, body: { error: "email_taken" } };
      }
      emails.add(email);
    }
    issued += 1;
    counts.creates += 1;
    const id = `${options.idPrefix ?? "cust-"}${issued}`;
    live.add(id);
    const name = (body as { name?: unknown } | undefined)?.name;
    const dropped = options.dropIdEvery !== undefined && issued % options.dropIdEvery === 0;
    return { status: 201, headers: { Location: `/api/v1/customers/${id}` }, body: dropped ? { name } : { id, name } };
  };

  const ITEM_COUNTS: Record<string, keyof CustomersTarget["counts"]> = { GET: "reads", PUT: "replaces", PATCH: "patches", DELETE: "deletes" };

  const itemRequest = (method: string, id: string): Handled => {
    const counter = ITEM_COUNTS[method];
    if (!counter) return undefined;
    counts[counter] += 1;
    if (!live.has(id)) {
      counts.notFound += 1;
      return { status: 404, body: { error: "not_found" } };
    }
    if (method === "DELETE") {
      live.delete(id);
      return { status: 204 };
    }
    if (method === "GET") {
      singleReads += 1;
      if (options.wrongIdEvery !== undefined && singleReads % options.wrongIdEvery === 0) {
        counts.wrongIds += 1;
        return { status: 200, body: { id: `${id}-other`, name: "Customer", status: "ACTIVE" } };
      }
      return { status: 200, body: { id, name: "Customer", status: "ACTIVE" } };
    }
    return { status: 200, body: { id, name: "Customer" } };
  };

  const slowed = (handled: Handled): Handled => {
    if (!handled || options.slowEvery === undefined) return handled;
    customerResponses += 1;
    if (customerResponses % options.slowEvery !== 0) return handled;
    counts.slow += 1;
    return { ...handled, delayMs: options.slowMs ?? 600 };
  };

  const handler: RequestHandler = (request) => (CUSTOMERS.test(request.path) ? slowed(respond(request)) : respond(request));

  const respond: RequestHandler = (request) => {
    if (options.auth && request.method === "POST" && request.path === "/auth/token") return issueToken(options.auth);
    if (options.auth && request.method === "GET" && (request.path === "/health" || request.path === "/version")) {
      return { status: 200, body: request.path === "/health" ? { status: "ok" } : { version: "1.0.0" } };
    }
    if (CUSTOMERS.test(request.path) && !authorized(request.headers.authorization)) {
      counts.unauthorized += 1;
      return { status: 401, body: { error: "unauthorized" } };
    }
    if (request.path === "/api/v1/customers") {
      if (request.method === "POST") return create(request.body);
      return request.method === "GET" && options.auth ? { status: 200, body: { items: [] } } : undefined;
    }
    const item = ITEM.exec(request.path);
    return item ? itemRequest(request.method, decodeURIComponent(item[1])) : undefined;
  };
  return { handler, counts, bodies };
}
