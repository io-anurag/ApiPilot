import { isWriteMethod, type CollectionRequestView, type WriteMethod } from "@apipilot/shared-domain";

/** The write methods in the order the warning lists them (the shared domain does not export its own list). */
const WRITE_METHOD_ORDER: readonly WriteMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

export interface CollectionRunWrite {
  requestId: string;
  method: WriteMethod;
  name: string;
}

export interface CollectionRunSetup {
  /** The requests the run will send, in run order. */
  selected: readonly CollectionRequestView[];
  /** Distinct targets of those requests, in first-seen order. A `{{variable}}` host is kept as
   * written when it is not resolved. */
  hosts: readonly string[];
  writes: readonly CollectionRunWrite[];
  /** Write count per method, in a fixed method order, for methods that occur. */
  writesByMethod: readonly { method: WriteMethod; count: number }[];
  /** Variables the selected requests use but no value is set for, sorted. */
  unresolvedVariables: readonly string[];
  /** Why a run cannot start yet; `null` when it can. */
  blockedReason: string | null;
}

/** The host (with port) of a request URL, or its leading `{{variable}}` when it has no scheme. */
export function hostOfUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("{{")) {
    const end = trimmed.indexOf("}}");
    return end >= 0 ? trimmed.slice(0, end + 2) : trimmed;
  }
  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed.length > 0 ? trimmed.split("/")[0] : "(no URL)";
  }
}

/**
 * What a collection run will do, read from the requests and the selection. Pure: nothing is sent or
 * changed, and the writes are counted from each request's own method (specs/026 clarifications), the
 * same basis as the backend's destructive-request confirmation.
 */
export function summarizeCollectionRun({
  orderedRequests,
  selectedIds,
}: Readonly<{
  /** Every request, already in run order. */
  orderedRequests: readonly CollectionRequestView[];
  selectedIds: ReadonlySet<string>;
}>): CollectionRunSetup {
  const selected = orderedRequests.filter((request) => selectedIds.has(request.id));

  const hosts: string[] = [];
  for (const request of selected) {
    const host = hostOfUrl(request.resolved.url);
    if (!hosts.includes(host)) hosts.push(host);
  }

  const writes: CollectionRunWrite[] = [];
  for (const request of selected) {
    const method = request.resolved.method.toUpperCase();
    if (isWriteMethod(method)) writes.push({ requestId: request.id, method, name: request.name });
  }
  const writesByMethod = WRITE_METHOD_ORDER.map((method) => ({
    method,
    count: writes.filter((write) => write.method === method).length,
  })).filter((entry) => entry.count > 0);

  const unresolvedVariables = [
    ...new Set(selected.flatMap((request) => request.unresolvedVariables)),
  ].sort((left, right) => left.localeCompare(right));

  return {
    selected,
    hosts,
    writes,
    writesByMethod,
    unresolvedVariables,
    blockedReason:
      orderedRequests.length > 0 && selected.length === 0
        ? "No requests are selected. Tick at least one in Run order."
        : null,
  };
}
