import type { BodyUnavailableReason, CredentialKind } from "@apipilot/shared-domain";
import type { ConsumerValueRecord, ValueRecord } from "./valueEvidence";

/**
 * Internal shapes of the HAR pipeline (specs/056 research R8 to R19). Nothing here is part of the
 * shared domain: an `ExtractedEntry` is what survives of one capture entry after extraction and
 * redaction, and is discarded once the model is built.
 */

/** The outcome of reading one request or response body. */
export type BodyOutcome =
  /** No body was observed (and none is evidenced), which is normal, for example for a `GET`. */
  | { kind: "absent" }
  /** `format: "json"` carries the parsed value; `"form"` a flat object of text field name to string value. All credential values already replaced. */
  | { kind: "available"; format: "json" | "form"; value: unknown; duplicateFieldName?: boolean }
  /** A body existed (or is evidenced) but cannot be used; `formFields` keeps a multipart request's text fields as evidence. */
  | { kind: "unavailable"; reason: BodyUnavailableReason; formFields?: Record<string, string> };

export interface ExtractedEntry {
  /** Zero-based position in `log.entries`. */
  index: number;
  /** Upper-case HTTP method. */
  method: string;
  scheme: string;
  /** Lower-case host name without port; empty for a scheme with no authority. */
  host: string;
  /** `scheme://host[:port]` with the default port removed; empty for a scheme with no authority. */
  origin: string;
  /** Normalized path (see contracts/har-import-rules.md); empty for a scheme with no authority. */
  path: string;
  /** Query parameters in order, values already redacted. */
  query: { name: string; value: string }[];
  /** Request headers by lower-case name, values already redacted (first occurrence wins). */
  requestHeaders: Record<string, string>;
  /** Media type of the request body without parameters, lower-case. */
  requestContentType?: string;
  requestBody: BodyOutcome;
  status: number;
  /** Media type of the response body without parameters, lower-case. */
  responseContentType?: string;
  responseBody: BodyOutcome;
  /** Milliseconds since the epoch of `startedDateTime`, when it parses. */
  startedAt?: number;
  /** Credentials seen in this entry: location, name and kind only. */
  credentials: { location: "header" | "query" | "cookie" | "body" | "url-userinfo" | "path"; name: string; kind: CredentialKind }[];
  userinfoRemoved: boolean;
  /** True when the response is JSON or XML, or the request sent a JSON body, or the tool marked it XHR or fetch. */
  apiLike: boolean;
  /** `Access-Control-Request-Method` was present on the request. */
  hasPreflightHeader: boolean;
  /** The entry is a WebSocket or server-sent-event exchange. */
  streaming: boolean;
  /** Distinctive values returned in the response body, as digests (no raw value), for dependency evidence. */
  producerValues: ValueRecord[];
  /** Distinctive values sent in the path, query, headers and body, as digests, for dependency evidence. */
  consumerValues: ConsumerValueRecord[];
  /** Raw (pre-normalization) path count flags, summed into the report. */
  normalization: { trailingSlashFolded: boolean; duplicateSlashesCollapsed: boolean; dotSegmentsRemoved: number };
}

export type ExtractResult =
  | { kind: "entry"; entry: ExtractedEntry }
  | { kind: "malformed"; reason: string };
