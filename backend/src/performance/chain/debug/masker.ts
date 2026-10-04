import type { DebugBody, DebugHeader, MaskedText, TextSegment } from "@apipilot/shared-domain";
import { isBearerTokenValue, isSensitiveFieldName, isSensitiveHeaderName } from "../../../testDesign/sensitiveValueDetection";

/**
 * The masker of a Debug run (specs/039-chain-debug-run research R5). Every piece of text a request or
 * response carried passes through here before it leaves the server, and comes out as `MaskedText`:
 * the original text, split around the sensitive values it contains. The text is never reformatted, so
 * what the engineer reads is what went over the wire, apart from the masked pieces.
 *
 * Two kinds of sensitive value, held in one list:
 * - values the engineer supplied as secrets (secret environment values, secret data set columns):
 *   masked and NEVER revealable, and never placed in a result, held or logged (FR-015b);
 * - values that came from the target or sit at a credential-looking position (sensitive headers,
 *   sensitive JSON fields and query parameters, extracted credentials): masked and revealable one at
 *   a time (FR-015a). Their real values are kept for the reveal call and nowhere else.
 *
 * One value gets one `valueId`, so a token that appears in a header and in a later URL is one reveal.
 * Masking splits on every occurrence, longest value first. A secret shorter than
 * `MIN_SCANNED_LENGTH` is not replaced inside free text, where a one or two character scan would shred
 * the output; it is still masked wherever the whole value is a header value, a query value or a form
 * value (documented limit, quickstart).
 */

export const MIN_SCANNED_LENGTH = 3;
/** The most text shown for one body, after masking (research R4). */
export const DISPLAY_LIMIT_CHARS = 64 * 1024;
const MAX_LITERALS = 2000;
const MAX_JSON_NODES = 20_000;
const MAX_JSON_DEPTH = 64;

interface Literal {
  value: string;
  revealable: boolean;
  label: string;
  valueId: string;
}

export interface SecretValue {
  /** What the value is called in the plan or data set, for the label. */
  name: string;
  value: string;
  kind: "environment" | "data-column";
}

export class Masker {
  private readonly literals = new Map<string, Literal>();
  private sorted: Literal[] | null = null;
  private counter = 0;

  /** The engineer-supplied secrets: never revealable. */
  constructor(secrets: readonly SecretValue[]) {
    for (const secret of secrets) {
      if (secret.value === "") continue;
      this.add(secret.value, false, secret.kind === "environment" ? `secret value ${secret.name}` : `secret data column ${secret.name}`);
    }
  }

  private add(value: string, revealable: boolean, label: string): void {
    if (value === "" || this.literals.size >= MAX_LITERALS) return;
    const known = this.literals.get(value);
    if (known) {
      // A value that is secret anywhere stays unrevealable.
      if (known.revealable && !revealable) known.revealable = false;
      return;
    }
    this.counter += 1;
    this.literals.set(value, { value, revealable, label, valueId: `v${this.counter}` });
    this.sorted = null;
  }

  /** Registers a value from the target or a credential-looking position; revealable. */
  addRevealable(value: string, label: string): void {
    this.add(value, true, label);
  }

  /** Registers an extracted value when its name or shape says credential (FR-015). */
  addExtracted(name: string, value: string): boolean {
    if (!isSensitiveFieldName(name) && !isBearerTokenValue(value)) return false;
    this.add(value, true, `extracted value ${name}`);
    const bearer = /^Bearer\s+(\S+)/i.exec(value);
    if (bearer) this.add(bearer[1], true, `extracted value ${name}`);
    return true;
  }

  /** The real value of each revealable literal, by `valueId`: what the reveal store holds. */
  revealableValues(): Map<string, string> {
    const held = new Map<string, string>();
    for (const literal of this.literals.values()) if (literal.revealable) held.set(literal.valueId, literal.value);
    return held;
  }

  private ordered(): Literal[] {
    this.sorted ??= [...this.literals.values()].sort((a, b) => b.value.length - a.value.length);
    return this.sorted;
  }

  private segmentFor(literal: Literal): TextSegment {
    return { kind: "masked", valueId: literal.valueId, revealable: literal.revealable, label: literal.label };
  }

  /** Splits `text` around every known sensitive value of at least `MIN_SCANNED_LENGTH` characters. */
  maskText(text: string): MaskedText {
    let pieces: TextSegment[] = text === "" ? [] : [{ kind: "text", text }];
    for (const literal of this.ordered()) {
      if (literal.value.length < MIN_SCANNED_LENGTH) continue;
      const next: TextSegment[] = [];
      for (const piece of pieces) {
        if (piece.kind !== "text" || !piece.text.includes(literal.value)) {
          next.push(piece);
          continue;
        }
        const parts = piece.text.split(literal.value);
        parts.forEach((part, index) => {
          if (index > 0) next.push(this.segmentFor(literal));
          if (part !== "") next.push({ kind: "text", text: part });
        });
      }
      pieces = next;
    }
    return pieces;
  }

  /** A value that stands alone (header value, query value, form value): masked whole when it equals a secret of any length. */
  maskStructuredValue(value: string): MaskedText {
    const exact = this.literals.get(value);
    if (exact) return [this.segmentFor(exact)];
    return this.maskText(value);
  }

  /** A header: a sensitive name masks the whole value (and registers it, so it is masked elsewhere too). */
  maskHeader(name: string, value: string): DebugHeader {
    if (isSensitiveHeaderName(name) || isSensitiveFieldName(name)) {
      if (value === "") return { name, value: [] };
      this.add(value, true, `${name} header`);
      const bearer = /^Bearer\s+(\S+)/i.exec(value);
      if (bearer) this.add(bearer[1], true, `${name} header`);
      const literal = this.literals.get(value)!;
      return { name, value: [this.segmentFor(literal)] };
    }
    if (isBearerTokenValue(value)) {
      this.add(value, true, `${name} header`);
      const bearer = /^Bearer\s+(\S+)/i.exec(value);
      if (bearer) this.add(bearer[1], true, `${name} header`);
    }
    return { name, value: this.maskStructuredValue(value) };
  }

  /** Registers the values at credential-named query parameters of `queryOrForm` (`a=b&c=d`). */
  private registerPairs(pairs: string, source: string): void {
    for (const pair of pairs.split("&")) {
      const at = pair.indexOf("=");
      if (at < 0) continue;
      const name = safeDecode(pair.slice(0, at));
      if (!isSensitiveFieldName(name)) continue;
      const raw = pair.slice(at + 1);
      this.add(raw, true, `${source} ${name}`);
      this.add(safeDecode(raw), true, `${source} ${name}`);
    }
  }

  /** Registers credential-named JSON field values found in `text`, if it parses as JSON. */
  private registerJsonFields(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    let nodes = 0;
    const visit = (value: unknown, depth: number): void => {
      if (nodes >= MAX_JSON_NODES || depth > MAX_JSON_DEPTH || value === null || typeof value !== "object") return;
      nodes += 1;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (isSensitiveFieldName(key) && (typeof child === "string" || typeof child === "number")) this.add(String(child), true, `field ${key}`);
        visit(child, depth + 1);
      }
    };
    visit(parsed, 0);
  }

  /**
   * Masks a URL: sensitive query parameter values and any user-info password are registered, query
   * and form style values are masked whole when they equal a known value, the rest is split as text.
   */
  maskUrl(url: string): MaskedText {
    const password = userInfoPassword(url);
    if (password !== null) this.add(safeDecode(password), true, "URL password");
    const queryAt = url.indexOf("?");
    if (queryAt < 0) return this.maskText(url);
    const head = url.slice(0, queryAt);
    const query = url.slice(queryAt + 1);
    this.registerPairs(query, "query parameter");
    const out: TextSegment[] = [...this.maskText(`${head}?`)];
    query.split("&").forEach((pair, index) => {
      if (index > 0) out.push({ kind: "text", text: "&" });
      const at = pair.indexOf("=");
      if (at < 0) {
        out.push(...this.maskText(pair));
        return;
      }
      out.push(...this.maskText(pair.slice(0, at + 1)));
      const rawValue = pair.slice(at + 1);
      const known = this.literals.get(rawValue) ?? this.literals.get(safeDecode(rawValue));
      out.push(...(known ? [this.segmentFor(known)] : this.maskText(rawValue)));
    });
    return mergeText(out);
  }

  /**
   * Registers the credential values a body holds, without masking it, and returns its text. A Debug run
   * observes every body before it masks any, so a value found in a later response is also masked in an
   * earlier one.
   */
  observeBody(bytes: Uint8Array, contentType: string | null): string {
    const text = new TextDecoder("utf-8").decode(bytes);
    const type = contentType?.split(";")[0].trim().toLowerCase() ?? "";
    if (type === "application/x-www-form-urlencoded") this.registerPairs(text, "form field");
    else this.registerJsonFields(text);
    return text;
  }

  /** Registers a URL's credential values without masking it. */
  observeUrl(url: string): void {
    this.maskUrl(url);
  }

  /** Registers a header's credential value without masking it. */
  observeHeader(name: string, value: string): void {
    this.maskHeader(name, value);
  }

  /**
   * Describes and masks a body. `bytes` is what was read (at most the read cap); `truncatedByRead` says
   * the body was longer. Text is registered for credential fields first, then masked, then cut to
   * `DISPLAY_LIMIT_CHARS`, so a value is never cut in half and shown.
   */
  maskBody(bytes: Uint8Array | null, contentType: string | null, truncatedByRead: boolean): DebugBody {
    if (bytes === null || bytes.length === 0) return { kind: "none" };
    if (looksBinary(bytes, contentType)) return { kind: "binary", contentType, sizeBytes: bytes.length };
    const text = this.observeBody(bytes, contentType);
    const masked = this.maskText(text);
    const cut = truncate(masked, DISPLAY_LIMIT_CHARS);
    return { kind: "text", contentType, text: cut.text, sizeBytes: bytes.length, truncated: cut.truncated || truncatedByRead };
  }
}

function safeDecode(component: string): string {
  try {
    return decodeURIComponent(component.replaceAll("+", " "));
  } catch {
    return component;
  }
}

/** The password of a URL's user-info (`scheme://user:password@host`), or `null`. Linear: no backtracking pattern. */
function userInfoPassword(url: string): string | null {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd < 0) return null;
  const rest = url.slice(schemeEnd + 3);
  let authorityEnd = rest.length;
  for (const stop of ["/", "?", "#"]) {
    const at = rest.indexOf(stop);
    if (at >= 0 && at < authorityEnd) authorityEnd = at;
  }
  const authority = rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf("@");
  if (at < 0) return null;
  const userInfo = authority.slice(0, at);
  const colon = userInfo.indexOf(":");
  return colon < 0 ? null : userInfo.slice(colon + 1);
}

function mergeText(segments: TextSegment[]): TextSegment[] {
  const merged: TextSegment[] = [];
  for (const segment of segments) {
    const last = merged.at(-1);
    if (segment.kind === "text" && last?.kind === "text") merged[merged.length - 1] = { kind: "text", text: last.text + segment.text };
    else merged.push(segment);
  }
  return merged;
}

/** Cuts `segments` to `limit` characters of text; a masked segment counts for none and is never cut. */
export function truncate(segments: MaskedText, limit: number): { text: MaskedText; truncated: boolean } {
  const out: TextSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    if (segment.kind === "masked") {
      out.push(segment);
      continue;
    }
    const room = limit - used;
    if (segment.text.length <= room) {
      out.push(segment);
      used += segment.text.length;
      continue;
    }
    if (room > 0) out.push({ kind: "text", text: segment.text.slice(0, room) });
    return { text: out, truncated: true };
  }
  return { text: out, truncated: false };
}

const BINARY_TYPE_PREFIXES = ["image/", "audio/", "video/", "font/"];
const BINARY_TYPES = new Set(["application/octet-stream", "application/pdf", "application/zip", "application/gzip", "application/x-tar", "application/x-7z-compressed", "application/wasm"]);

function looksBinary(bytes: Uint8Array, contentType: string | null): boolean {
  const type = contentType?.split(";")[0].trim().toLowerCase() ?? "";
  if (BINARY_TYPES.has(type) || BINARY_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;
  const sample = bytes.subarray(0, 8000);
  return sample.includes(0);
}
