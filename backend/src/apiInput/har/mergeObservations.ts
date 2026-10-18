import type { BodyUnavailableReason, ObservedRequestExample } from "@apipilot/shared-domain";
import { MAX_EXAMPLES_PER_OPERATION } from "../limits";
import { SchemaInferrer } from "./inferSchema";
import type { InferredPath } from "./inferPathParameters";
import type { ExtractedEntry } from "./types";

/**
 * Merges the observations of one operation (specs/056 FR-014, research R15): counts for every fact,
 * up to five request examples, and one schema inferrer per body shape. Nothing here is a documented
 * fact; every count says how often the capture showed it.
 */

/** Request headers that describe the capturing browser or transport, not the API (contract list). */
export function isNoiseHeader(lowerName: string): boolean {
  return (
    NOISE_HEADERS.has(lowerName) ||
    lowerName.startsWith("sec-") ||
    lowerName.startsWith(":") ||
    lowerName.startsWith("if-") ||
    lowerName.startsWith("access-control-request-")
  );
}

const NOISE_HEADERS: ReadonlySet<string> = new Set([
  "host", "connection", "content-length", "accept-encoding", "accept-language", "user-agent", "origin", "referer",
  "pragma", "cache-control", "upgrade-insecure-requests", "dnt", "te", "keep-alive",
]);

const MAX_TRACKED_EXAMPLES = 100;
const DEFAULT_REQUEST_CONTENT_TYPE = "application/json";
const DEFAULT_RESPONSE_CONTENT_TYPE = "application/json";

export interface MergedExample extends ObservedRequestExample {
  /** Insertion order, used only to keep ties stable. */
  order: number;
}

export interface UnavailableBodyCount {
  direction: "request" | "response";
  reason: BodyUnavailableReason;
  count: number;
}

export interface OperationGroup {
  origin: string;
  method: string;
  /** The inferred pattern, `{name}` for path parameters. */
  path: string;
  parameters: InferredPath["parameters"];
  ambiguous: InferredPath["ambiguous"];
  observationCount: number;
  entryIndexes: number[];
  statusCounts: Record<string, number>;
  queryParameterCounts: Record<string, number>;
  headerCounts: Record<string, number>;
  /** Kept examples, best first, at most `MAX_EXAMPLES_PER_OPERATION`. */
  examples: MergedExample[];
  droppedExampleCount: number;
  requestEvidence: Map<string, SchemaInferrer>;
  /** How many request bodies carried each content type's fields (examples exist only for available bodies). */
  requestBodyObservations: Map<string, number>;
  responseEvidence: Map<string, Map<string, SchemaInferrer>>;
  /** The first available response body per status, as an example (credential values already replaced). */
  responseExamples: Map<string, unknown>;
  /** The first reason a status's bodies were unavailable, when no body of that status was usable. */
  responseUnavailable: Map<string, BodyUnavailableReason>;
  unavailable: UnavailableBodyCount[];
  /** Entries whose form body repeated a field name (the first value was kept). */
  duplicateFormFieldEntries: number;
  credentials: { location: string; name: string; kind: string; observations: number }[];
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedRecord(counts: Map<string, number>, numeric = false): Record<string, number> {
  const keys = [...counts.keys()].sort((a, b) => (numeric ? Number(a) - Number(b) || compare(a, b) : compare(a, b)));
  const out: Record<string, number> = {};
  for (const key of keys) Object.defineProperty(out, key, { value: counts.get(key), enumerable: true, writable: true, configurable: true });
  return out;
}

export class OperationAccumulator {
  private observationCount = 0;
  private readonly entryIndexes: number[] = [];
  private readonly statusCounts = new Map<string, number>();
  private readonly queryCounts = new Map<string, number>();
  private readonly headerCounts = new Map<string, number>();
  private readonly examples = new Map<string, MergedExample>();
  private overflowExamples = 0;
  private nextExampleOrder = 0;
  private readonly requestEvidence = new Map<string, SchemaInferrer>();
  private readonly requestBodyObservations = new Map<string, number>();
  private readonly responseEvidence = new Map<string, Map<string, SchemaInferrer>>();
  private readonly responseExamples = new Map<string, unknown>();
  private readonly responseUsable = new Set<string>();
  private readonly responseUnavailable = new Map<string, BodyUnavailableReason>();
  private readonly unavailable = new Map<string, UnavailableBodyCount>();
  private duplicateFormFieldEntries = 0;
  private readonly credentials = new Map<string, { location: string; name: string; kind: string; observations: number }>();

  constructor(
    private readonly origin: string,
    private readonly method: string,
    private readonly inferred: InferredPath,
  ) {}

  add(entry: ExtractedEntry, inferred: InferredPath): void {
    this.observationCount += 1;
    this.entryIndexes.push(entry.index);
    const status = String(entry.status);
    this.statusCounts.set(status, (this.statusCounts.get(status) ?? 0) + 1);

    for (const name of new Set(entry.query.map((param) => param.name))) {
      this.queryCounts.set(name, (this.queryCounts.get(name) ?? 0) + 1);
    }
    const keptHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(entry.requestHeaders)) {
      if (isNoiseHeader(name)) continue;
      this.headerCounts.set(name, (this.headerCounts.get(name) ?? 0) + 1);
      Object.defineProperty(keptHeaders, name, { value, enumerable: true, writable: true, configurable: true });
    }

    this.addRequestBody(entry);
    this.addExample(entry, inferred, keptHeaders, status);
    this.addResponseBody(entry, status);

    for (const credential of entry.credentials) {
      const key = `${credential.location}\u0000${credential.name}\u0000${credential.kind}`;
      const existing = this.credentials.get(key);
      if (existing) existing.observations += 1;
      else this.credentials.set(key, { ...credential, observations: 1 });
    }
  }

  private countUnavailable(direction: "request" | "response", reason: BodyUnavailableReason): void {
    const key = `${direction}\u0000${reason}`;
    const existing = this.unavailable.get(key);
    if (existing) existing.count += 1;
    else this.unavailable.set(key, { direction, reason, count: 1 });
  }

  private evidenceFor(contentType: string): SchemaInferrer {
    let inferrer = this.requestEvidence.get(contentType);
    if (!inferrer) {
      inferrer = new SchemaInferrer();
      this.requestEvidence.set(contentType, inferrer);
    }
    return inferrer;
  }

  private addRequestBody(entry: ExtractedEntry): void {
    const body = entry.requestBody;
    const contentType = entry.requestContentType ?? DEFAULT_REQUEST_CONTENT_TYPE;
    if (body.kind === "available") {
      this.evidenceFor(contentType).add(body.value);
      this.requestBodyObservations.set(contentType, (this.requestBodyObservations.get(contentType) ?? 0) + 1);
      if (body.duplicateFieldName) this.duplicateFormFieldEntries += 1;
    } else if (body.kind === "unavailable") {
      this.countUnavailable("request", body.reason);
      if (body.formFields) {
        this.evidenceFor(contentType).add(body.formFields);
        this.requestBodyObservations.set(contentType, (this.requestBodyObservations.get(contentType) ?? 0) + 1);
      }
    }
  }

  private addExample(entry: ExtractedEntry, inferred: InferredPath, headers: Record<string, string>, status: string): void {
    const queryParameters: Record<string, unknown> = {};
    for (const { name, value } of entry.query) {
      if (!(name in queryParameters)) Object.defineProperty(queryParameters, name, { value, enumerable: true, writable: true, configurable: true });
    }
    const example: Omit<MergedExample, "order" | "observations" | "firstEntryIndex"> = {
      pathParameters: { ...inferred.valuesByParameter },
      queryParameters,
      headers,
      responseStatus: status,
    };
    const body = entry.requestBody;
    const contentType = entry.requestContentType;
    const withBody: typeof example & { body?: unknown; contentType?: string; bodyUnavailable?: BodyUnavailableReason } = { ...example };
    if (body.kind === "available") {
      withBody.body = body.value;
      if (contentType) withBody.contentType = contentType;
    } else if (body.kind === "unavailable") {
      withBody.bodyUnavailable = body.reason;
      if (contentType) withBody.contentType = contentType;
    }
    const key = JSON.stringify(withBody);
    const existing = this.examples.get(key);
    if (existing) {
      existing.observations += 1;
      return;
    }
    if (this.examples.size >= MAX_TRACKED_EXAMPLES) {
      this.overflowExamples += 1;
      return;
    }
    this.examples.set(key, { ...withBody, observations: 1, firstEntryIndex: entry.index, order: this.nextExampleOrder++ });
  }

  private addResponseBody(entry: ExtractedEntry, status: string): void {
    const body = entry.responseBody;
    const contentType = entry.responseContentType ?? DEFAULT_RESPONSE_CONTENT_TYPE;
    if (body.kind === "available") {
      let byType = this.responseEvidence.get(status);
      if (!byType) {
        byType = new Map();
        this.responseEvidence.set(status, byType);
      }
      let inferrer = byType.get(contentType);
      if (!inferrer) {
        inferrer = new SchemaInferrer();
        byType.set(contentType, inferrer);
      }
      inferrer.add(body.value);
      this.responseUsable.add(status);
      if (!this.responseExamples.has(status)) this.responseExamples.set(status, body.value);
    } else if (body.kind === "unavailable") {
      this.countUnavailable("response", body.reason);
      if (!this.responseUnavailable.has(status)) this.responseUnavailable.set(status, body.reason);
    }
  }

  build(): OperationGroup {
    const ranked = [...this.examples.values()].sort(
      (a, b) => b.observations - a.observations || a.firstEntryIndex - b.firstEntryIndex || a.order - b.order,
    );
    const responseUnavailable = new Map<string, BodyUnavailableReason>();
    for (const [status, reason] of this.responseUnavailable) {
      if (!this.responseUsable.has(status)) responseUnavailable.set(status, reason);
    }
    return {
      origin: this.origin,
      method: this.method,
      path: this.inferred.pattern,
      parameters: this.inferred.parameters,
      ambiguous: this.inferred.ambiguous,
      observationCount: this.observationCount,
      entryIndexes: this.entryIndexes,
      statusCounts: sortedRecord(this.statusCounts, true),
      queryParameterCounts: sortedRecord(this.queryCounts),
      headerCounts: sortedRecord(this.headerCounts),
      examples: ranked.slice(0, MAX_EXAMPLES_PER_OPERATION),
      droppedExampleCount: Math.max(0, ranked.length - MAX_EXAMPLES_PER_OPERATION) + this.overflowExamples,
      requestEvidence: this.requestEvidence,
      requestBodyObservations: this.requestBodyObservations,
      responseEvidence: this.responseEvidence,
      responseExamples: this.responseExamples,
      responseUnavailable,
      unavailable: [...this.unavailable.values()].sort(
        (a, b) => compare(a.direction, b.direction) || compare(a.reason, b.reason),
      ),
      duplicateFormFieldEntries: this.duplicateFormFieldEntries,
      credentials: [...this.credentials.values()].sort(
        (a, b) => compare(a.location, b.location) || compare(a.name, b.name) || compare(a.kind, b.kind),
      ),
    };
  }
}
