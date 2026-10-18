import type { InputLimits } from "../limits";
import { ownEntries } from "../jsonSafe";
import {
  CredentialCollector,
  classifyValue,
  redactHeaderValue,
  redactJsonValue,
  redactNamedValue,
  redactUrl,
} from "../redaction";
import { formatRedactionPlaceholder } from "../../testDesign/sensitiveValueDetection";
import { decodeBody, mediaType, type RawBody } from "./decodeBody";
import { isNoiseHeader } from "./mergeObservations";
import { parseEntryUrl } from "./normalizeUrl";
import {
  harvestBodyValues,
  harvestHeaderValues,
  harvestPathValues,
  harvestQueryValues,
  type ConsumerValueRecord,
} from "./valueEvidence";
import type { BodyOutcome, ExtractResult } from "./types";

/**
 * Turns one raw HAR entry into an `ExtractedEntry`, or reports why it is malformed (specs/056 FR-010,
 * FR-011). It copies only the fields named below (an allow-list: tool extensions such as Chrome's
 * `_`-prefixed fields are ignored, apart from the two presence markers read here) and redacts every
 * credential before anything is returned, so an unredacted value never leaves this function
 * (FR-047, research R18).
 */

const MAX_HEADERS_PER_ENTRY = 200;
const MAX_QUERY_PARAMS_PER_ENTRY = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** HAR `headers` array to a lower-case name map; the first occurrence of a name wins. */
function headerMap(headers: unknown): Record<string, string> {
  const map: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!Array.isArray(headers)) return map;
  for (const header of headers.slice(0, MAX_HEADERS_PER_ENTRY)) {
    if (!isPlainObject(header)) continue;
    const name = stringOf(header.name);
    if (name === undefined || name === "") continue;
    const lower = name.toLowerCase();
    if (lower in map) continue;
    map[lower] = stringOf(header.value) ?? "";
  }
  return map;
}

const JSON_LIKE = /^(application|text)\/([\w.+-]*\+)?(json|xml)$/;

function redactOutcome(outcome: BodyOutcome, collector: CredentialCollector): BodyOutcome {
  if (outcome.kind === "available") {
    if (outcome.format === "json") {
      return { ...outcome, value: redactJsonValue(outcome.value, collector, "body") };
    }
    const fields: Record<string, string> = {};
    for (const [name, value] of ownEntries(outcome.value as object)) {
      Object.defineProperty(fields, name, {
        value: String(redactNamedValue("body", name, value, collector)),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return { ...outcome, value: fields };
  }
  if (outcome.kind === "unavailable" && outcome.formFields) {
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(outcome.formFields)) {
      Object.defineProperty(fields, name, {
        value: String(redactNamedValue("body", name, value, collector)),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return { ...outcome, formFields: fields };
  }
  return outcome;
}

export function extractEntry(raw: unknown, index: number, limits: InputLimits): ExtractResult {
  if (!isPlainObject(raw)) return { kind: "malformed", reason: "not-an-object" };
  const request = raw.request;
  if (!isPlainObject(request)) return { kind: "malformed", reason: "missing-url" };

  const rawUrl = stringOf(request.url);
  if (rawUrl === undefined || rawUrl.trim() === "") return { kind: "malformed", reason: "missing-url" };
  const rawMethod = stringOf(request.method);
  if (rawMethod === undefined || rawMethod.trim() === "") return { kind: "malformed", reason: "missing-method" };
  const response = raw.response;
  const status = isPlainObject(response) ? response.status : undefined;
  if (typeof status !== "number" || !Number.isInteger(status)) {
    return { kind: "malformed", reason: "missing-response-status" };
  }

  const collector = new CredentialCollector();
  const redactedUrl = redactUrl(rawUrl.trim());
  if (redactedUrl.userinfoRemoved) collector.record("url-userinfo", "userinfo", "password");
  const parsed = parseEntryUrl(redactedUrl.url);
  if (!parsed.ok) return { kind: "malformed", reason: parsed.reason };

  // Path segments that are credentials by shape (a JWT in a path) never reach the model.
  let path = parsed.normalization.path;
  if (path !== "") {
    path = `/${path
      .split("/")
      .slice(1)
      .map((segment) => {
        const kind = classifyValue(segment);
        if (kind === undefined) return segment;
        collector.record("path", "(segment)", kind);
        return formatRedactionPlaceholder(kind);
      })
      .join("/")}`;
  }

  // Dependency evidence is harvested from the raw path segments before any redaction, as digests.
  const consumerValues: ConsumerValueRecord[] = harvestPathValues(parsed.normalization.path);

  // Query parameters: the capture's own list when present, else the URL's query string.
  const query: { name: string; value: string }[] = [];
  const rawQuery: { name: string; value: string }[] = [];
  if (Array.isArray(request.queryString)) {
    for (const item of request.queryString.slice(0, MAX_QUERY_PARAMS_PER_ENTRY)) {
      if (!isPlainObject(item)) continue;
      const name = stringOf(item.name);
      if (name === undefined || name === "") continue;
      rawQuery.push({ name, value: stringOf(item.value) ?? "" });
      query.push({ name, value: String(redactNamedValue("query", name, stringOf(item.value) ?? "", collector)) });
    }
  } else if (parsed.search !== "") {
    for (const [name, value] of new URLSearchParams(parsed.search)) {
      if (query.length >= MAX_QUERY_PARAMS_PER_ENTRY) break;
      rawQuery.push({ name, value });
      query.push({ name, value: String(redactNamedValue("query", name, value, collector)) });
    }
  }
  consumerValues.push(...harvestQueryValues(rawQuery));

  // Request headers: redacted values by lower-case name.
  const rawRequestHeaders = headerMap(request.headers);
  const hasPreflightHeader = "access-control-request-method" in rawRequestHeaders;
  consumerValues.push(...harvestHeaderValues(rawRequestHeaders, isNoiseHeader));
  const requestHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawRequestHeaders)) {
    Object.defineProperty(requestHeaders, name, {
      value: redactHeaderValue(name, value, collector),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  // Request body.
  const postData = isPlainObject(request.postData) ? request.postData : undefined;
  const requestMime = stringOf(postData?.mimeType) ?? rawRequestHeaders["content-type"];
  const contentLength = Number(rawRequestHeaders["content-length"]);
  const requestRaw: RawBody = {
    text: stringOf(postData?.text),
    mimeType: requestMime,
    params: Array.isArray(postData?.params) ? (postData?.params as RawBody["params"]) : undefined,
    postDataPresent: postData !== undefined,
    declaredSize: Number.isFinite(contentLength) ? contentLength : undefined,
  };
  const decodedRequest = decodeBody(requestRaw, "request", limits);
  if (decodedRequest.kind === "available") {
    consumerValues.push(...harvestBodyValues(decodedRequest.value).map((record) => ({ ...record, location: "body" as const })));
  }
  const requestBody = redactOutcome(decodedRequest, collector);

  // Response: headers matter only for credentials set by the server and for the encoding; bodies are decoded and redacted.
  const rawResponseHeaders = headerMap(isPlainObject(response) ? response.headers : undefined);
  for (const [name, value] of Object.entries(rawResponseHeaders)) redactHeaderValue(name, value, collector);
  const content = isPlainObject(response) && isPlainObject(response.content) ? response.content : undefined;
  const responseMime = stringOf(content?.mimeType) ?? rawResponseHeaders["content-type"];
  const responseRaw: RawBody = {
    text: stringOf(content?.text),
    mimeType: responseMime,
    encoding: stringOf(content?.encoding),
    declaredSize: numberOf(content?.size),
    contentEncodingHeader: rawResponseHeaders["content-encoding"]?.trim().toLowerCase(),
  };
  const decodedResponse = decodeBody(responseRaw, "response", limits);
  const producerValues = decodedResponse.kind === "available" && status >= 200 && status < 300 ? harvestBodyValues(decodedResponse.value) : [];
  const responseBody = redactOutcome(decodedResponse, collector);

  const responseContentType = mediaType(responseMime);
  const startedAt = Date.parse(stringOf(raw.startedDateTime) ?? "");
  const resourceType = stringOf(raw._resourceType)?.toLowerCase();
  const apiLike =
    (responseContentType !== undefined && JSON_LIKE.test(responseContentType)) ||
    (requestBody.kind === "available" && requestBody.format === "json") ||
    resourceType === "xhr" ||
    resourceType === "fetch";

  return {
    kind: "entry",
    entry: {
      index,
      method: rawMethod.trim().toUpperCase(),
      scheme: parsed.scheme,
      host: parsed.host,
      origin: parsed.origin,
      path,
      query,
      requestHeaders,
      requestContentType: mediaType(requestMime),
      requestBody,
      status,
      responseContentType,
      responseBody,
      startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
      credentials: collector.list(),
      userinfoRemoved: redactedUrl.userinfoRemoved,
      apiLike,
      producerValues,
      consumerValues,
      hasPreflightHeader,
      streaming: Array.isArray(raw._webSocketMessages),
      normalization: {
        trailingSlashFolded: parsed.normalization.trailingSlashFolded,
        duplicateSlashesCollapsed: parsed.normalization.duplicateSlashesCollapsed,
        dotSegmentsRemoved: parsed.normalization.dotSegmentsRemoved,
      },
    },
  };
}
