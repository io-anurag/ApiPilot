import { isWriteMethod, type CollectionRequestView, type RequestVariableReference, type WriteMethod } from "@apipilot/shared-domain";

/** The write methods in the order the warning lists them (the shared domain does not export its own list). */
const WRITE_METHOD_ORDER: readonly WriteMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

export interface CollectionRunWrite {
  requestId: string;
  method: WriteMethod;
  name: string;
}

/** One variable the selected requests use, with where and whether it has a value (never the value: it may be secret). */
export interface CollectionRunVariable {
  name: string;
  /** How many of the selected requests use it. */
  requestCount: number;
  /** Where it appears across those requests, in a fixed order. */
  usedIn: readonly RequestVariableReference["usedIn"][number][];
  resolved: boolean;
  /** Where its value comes from; absent when it has none. */
  source?: RequestVariableReference["source"];
}

/** How many selected requests use one authentication type; requests with none count as `noauth`. */
export interface CollectionRunAuth {
  type: string;
  count: number;
}

/** How many selected requests sit in one folder; the collection root is an empty path. */
export interface CollectionRunFolder {
  folderPath: readonly string[];
  count: number;
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
  /** Every variable the selected requests use: those without a value first, then by name. */
  variables: readonly CollectionRunVariable[];
  /** Variables the selected requests use but no value is set for, sorted. */
  unresolvedVariables: readonly string[];
  /** The authentication types the selected requests use, most used first. */
  auth: readonly CollectionRunAuth[];
  /** Selected requests that carry a test script, so have checks that can fail. */
  withTests: number;
  /** Selected requests the engineer edited. */
  edited: number;
  /** Selected requests per folder, in run order of first appearance. Empty when folders are not known. */
  folders: readonly CollectionRunFolder[];
  /** The least time the run takes: the delay between requests across the gaps. `null` when there is no delay to count. */
  minimumDurationMs: number | null;
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
  placements,
  requestDelayMs = 0,
}: Readonly<{
  /** Every request, already in run order. */
  orderedRequests: readonly CollectionRequestView[];
  selectedIds: ReadonlySet<string>;
  /** Each request's folder path, keyed by request id. */
  placements?: ReadonlyMap<string, { folderPath: readonly string[] }>;
  /** The collection's delay between requests. */
  requestDelayMs?: number;
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

  const USED_IN_ORDER: readonly RequestVariableReference["usedIn"][number][] = ["url", "headers", "body", "auth"];
  const byName = new Map<string, { requestCount: number; usedIn: Set<string>; resolved: boolean; source?: RequestVariableReference["source"] }>();
  for (const request of selected) {
    for (const reference of request.variableReferences ?? []) {
      const entry = byName.get(reference.name) ?? { requestCount: 0, usedIn: new Set<string>(), resolved: true };
      entry.requestCount += 1;
      for (const place of reference.usedIn) entry.usedIn.add(place);
      // One request without a value leaves the variable unresolved for the run.
      entry.resolved = entry.resolved && reference.resolved;
      entry.source ??= reference.source;
      byName.set(reference.name, entry);
    }
  }
  const variables: CollectionRunVariable[] = [...byName.entries()]
    .map(([name, entry]) => ({
      name,
      requestCount: entry.requestCount,
      usedIn: USED_IN_ORDER.filter((place) => entry.usedIn.has(place)),
      resolved: entry.resolved,
      ...(entry.resolved && entry.source ? { source: entry.source } : {}),
    }))
    .sort((left, right) => Number(left.resolved) - Number(right.resolved) || left.name.localeCompare(right.name));

  const authCounts = new Map<string, number>();
  for (const request of selected) {
    const type = request.auth?.type ?? "noauth";
    authCounts.set(type, (authCounts.get(type) ?? 0) + 1);
  }
  const auth = [...authCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));

  const folderCounts = new Map<string, CollectionRunFolder>();
  if (placements) {
    for (const request of selected) {
      const folderPath = placements.get(request.id)?.folderPath ?? [];
      const key = folderPath.join("\u0000");
      const entry = folderCounts.get(key) ?? { folderPath, count: 0 };
      entry.count += 1;
      folderCounts.set(key, entry);
    }
  }

  return {
    selected,
    hosts,
    writes,
    writesByMethod,
    variables,
    unresolvedVariables,
    auth,
    withTests: selected.filter((request) => (request.testScript ?? "").trim() !== "").length,
    edited: selected.filter((request) => request.wasEdited).length,
    folders: [...folderCounts.values()],
    minimumDurationMs: requestDelayMs > 0 && selected.length > 1 ? requestDelayMs * (selected.length - 1) : null,
    blockedReason:
      orderedRequests.length > 0 && selected.length === 0
        ? "No requests are selected. Tick at least one in Run order."
        : null,
  };
}

/** `1.8 s`, or `2 min 5 s` from one minute; whole seconds once past ten. */
export function formatMinimumTime(ms: number): string {
  if (ms < 10_000) return `${Math.round(ms / 100) / 10} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return rest === 0 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 60)} min ${rest} s`;
}

/** A Postman auth type for people: `bearer` is `Bearer token`, `noauth` is `No auth`, others as stored. */
export function authLabel(type: string): string {
  const known: Record<string, string> = {
    noauth: "No auth",
    bearer: "Bearer token",
    basic: "Basic",
    apikey: "API key",
    oauth2: "OAuth 2.0",
    oauth1: "OAuth 1.0",
    digest: "Digest",
    awsv4: "AWS Signature",
    hawk: "Hawk",
    ntlm: "NTLM",
    jwt: "JWT",
  };
  return known[type.toLowerCase()] ?? type;
}
