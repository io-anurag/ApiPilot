import { EMBEDDED_BODY_MAX_DEPTH, type InputLimits } from "../limits";
import { nullProtoRecord, scanJsonDepth, toPlainRecord } from "../jsonSafe";
import type { BodyOutcome } from "./types";

/**
 * Reads one request or response body into a `BodyOutcome` (specs/056 FR-018, research R17). The result
 * is not yet redacted: the caller redacts it before it leaves the extraction step. Compression is
 * never undone and an unknown encoding is never guessed, so a decompression bomb or a mis-decoded
 * body cannot occur; a body that cannot be used says why.
 */

export type Direction = "request" | "response";

export interface RawBody {
  text?: string;
  mimeType?: string;
  /** `content.encoding` of a response body. */
  encoding?: string;
  /** `content.size` of a response, or the request's `Content-Length`, when present and numeric. */
  declaredSize?: number;
  /** HAR `postData.params` entries. */
  params?: { name?: unknown; value?: unknown; fileName?: unknown; contentType?: unknown }[];
  /** A `postData` object was present (even if empty). */
  postDataPresent?: boolean;
  /** Lower-case `Content-Encoding` header value, if any. */
  contentEncodingHeader?: string;
}

const JSON_MEDIA_TYPE = /^(application|text)\/(json|[\w.+-]*\+json)$/;
const COMPRESSED_ENCODINGS: ReadonlySet<string> = new Set(["gzip", "x-gzip", "br", "deflate", "compress", "zstd"]);
const BINARY_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
]);

/** The media type without parameters, lower-case, or undefined. */
export function mediaType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return base === "" ? undefined : base;
}

function isBinary(media: string): boolean {
  return (
    media.startsWith("image/") ||
    media.startsWith("audio/") ||
    media.startsWith("video/") ||
    BINARY_MEDIA_TYPES.has(media)
  );
}

function absence(direction: Direction, raw: RawBody): BodyOutcome {
  const declared = raw.declaredSize !== undefined && raw.declaredSize > 0;
  if (direction === "request") {
    if (raw.postDataPresent) return { kind: "unavailable", reason: "empty" };
    return declared ? { kind: "unavailable", reason: "missing" } : { kind: "absent" };
  }
  return declared ? { kind: "unavailable", reason: "missing" } : { kind: "absent" };
}

function parseUrlEncoded(text: string): { fields: Record<string, string>; duplicate: boolean } {
  const fields = nullProtoRecord<string>();
  let duplicate = false;
  for (const pair of text.split("&")) {
    if (pair === "") continue;
    const equals = pair.indexOf("=");
    const rawName = equals < 0 ? pair : pair.slice(0, equals);
    const rawValue = equals < 0 ? "" : pair.slice(equals + 1);
    const decode = (part: string): string => {
      try {
        return decodeURIComponent(part.replace(/\+/g, " "));
      } catch {
        return part;
      }
    };
    const name = decode(rawName);
    if (name in fields) {
      duplicate = true;
      continue;
    }
    fields[name] = decode(rawValue);
  }
  return { fields: toPlainRecord(fields), duplicate };
}

function formFromParams(params: NonNullable<RawBody["params"]>): { fields: Record<string, string>; duplicate: boolean } {
  const fields = nullProtoRecord<string>();
  let duplicate = false;
  for (const param of params) {
    if (typeof param.name !== "string" || param.name === "") continue;
    if (param.name in fields) {
      duplicate = true;
      continue;
    }
    fields[param.name] = typeof param.value === "string" ? param.value : "";
  }
  return { fields: toPlainRecord(fields), duplicate };
}

export function decodeBody(raw: RawBody, direction: Direction, limits: InputLimits): BodyOutcome {
  const media = mediaType(raw.mimeType);

  if (media === "multipart/form-data") {
    if (!raw.params || raw.params.length === 0) {
      return raw.text ? { kind: "unavailable", reason: "not-json" } : absence(direction, raw);
    }
    const hasFile = raw.params.some((param) => param.fileName !== undefined || param.contentType !== undefined);
    if (hasFile) {
      const textOnly = formFromParams(raw.params.filter((param) => param.fileName === undefined && param.contentType === undefined));
      return { kind: "unavailable", reason: "multipart-file", formFields: textOnly.fields };
    }
    const form = formFromParams(raw.params);
    return { kind: "available", format: "form", value: form.fields, ...(form.duplicate ? { duplicateFieldName: true } : {}) };
  }

  if (media === "application/x-www-form-urlencoded") {
    if (raw.params && raw.params.length > 0) {
      const form = formFromParams(raw.params);
      return { kind: "available", format: "form", value: form.fields, ...(form.duplicate ? { duplicateFieldName: true } : {}) };
    }
    if (raw.text) {
      const form = parseUrlEncoded(raw.text);
      return { kind: "available", format: "form", value: form.fields, ...(form.duplicate ? { duplicateFieldName: true } : {}) };
    }
    return absence(direction, raw);
  }

  const text = raw.text;
  if (text === undefined || text === "") return absence(direction, raw);
  if (media !== undefined && isBinary(media)) return { kind: "unavailable", reason: "binary" };

  const compressedByHeader = raw.contentEncodingHeader !== undefined && COMPRESSED_ENCODINGS.has(raw.contentEncodingHeader);
  let decoded: string;
  if (raw.encoding !== undefined && raw.encoding !== "") {
    if (raw.encoding.toLowerCase() !== "base64") return { kind: "unavailable", reason: "undecodable-encoding" };
    if (Math.floor((text.length * 3) / 4) > limits.maxBodyBytes) return { kind: "unavailable", reason: "oversized" };
    const bytes = Buffer.from(text, "base64");
    if ((bytes[0] === 0x1f && bytes[1] === 0x8b) || compressedByHeader) return { kind: "unavailable", reason: "compressed" };
    if (bytes.includes(0)) return { kind: "unavailable", reason: "binary" };
    decoded = bytes.toString("utf8");
  } else {
    decoded = text;
  }

  const byteLength = Buffer.byteLength(decoded, "utf8");
  if (byteLength > limits.maxBodyBytes) return { kind: "unavailable", reason: "oversized" };

  if (media !== undefined && JSON_MEDIA_TYPE.test(media)) {
    if (scanJsonDepth(decoded, EMBEDDED_BODY_MAX_DEPTH).exceeded) return { kind: "unavailable", reason: "too-deep" };
    try {
      return { kind: "available", format: "json", value: JSON.parse(decoded) as unknown };
    } catch {
      const truncated = raw.declaredSize !== undefined && raw.declaredSize > byteLength;
      return { kind: "unavailable", reason: truncated ? "truncated" : "invalid-json" };
    }
  }
  return { kind: "unavailable", reason: "not-json" };
}
