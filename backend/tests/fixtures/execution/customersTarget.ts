import type { RequestHandler } from "./targetServer";

/**
 * AP-035 (specs/035-user-defined-journeys tasks T004, quickstart 3 and 4): a stateful customers API
 * for `tests/fixtures/openapi/user-journeys.yaml`. Each `POST /api/v1/customers` issues a new id from
 * a counter (never random) with a `Location` header; `GET`, `PUT` and `DELETE` of an id never issued,
 * or already deleted, answer 404. With `dropIdEvery: n`, every n-th create omits `id` from its body.
 * Counts are kept by route and never record an id.
 */
export interface CustomersTarget {
  handler: RequestHandler;
  counts: { creates: number; reads: number; replaces: number; deletes: number; notFound: number };
}

const ITEM = /^\/api\/v1\/customers\/([^/]+)$/;

export function customersTarget(options: { dropIdEvery?: number; idPrefix?: string } = {}): CustomersTarget {
  const live = new Set<string>();
  let issued = 0;
  const counts = { creates: 0, reads: 0, replaces: 0, deletes: 0, notFound: 0 };
  const handler: RequestHandler = (request) => {
    if (request.method === "POST" && request.path === "/api/v1/customers") {
      issued += 1;
      counts.creates += 1;
      const id = `${options.idPrefix ?? "cust-"}${issued}`;
      live.add(id);
      const name = (request.body as { name?: unknown } | undefined)?.name;
      const dropped = options.dropIdEvery !== undefined && issued % options.dropIdEvery === 0;
      return { status: 201, headers: { Location: `/api/v1/customers/${id}` }, body: dropped ? { name } : { id, name } };
    }
    const item = ITEM.exec(request.path);
    if (!item) return undefined;
    const id = decodeURIComponent(item[1]);
    if (request.method === "GET") counts.reads += 1;
    else if (request.method === "PUT") counts.replaces += 1;
    else if (request.method === "DELETE") counts.deletes += 1;
    else return undefined;
    if (!live.has(id)) {
      counts.notFound += 1;
      return { status: 404, body: { error: "not_found" } };
    }
    if (request.method === "DELETE") {
      live.delete(id);
      return { status: 204 };
    }
    return { status: 200, body: { id, name: "Customer" } };
  };
  return { handler, counts };
}
