import type { BodyPathSegment, DebugExtractorFailure, Extractor } from "@apipilot/shared-domain";
import { parseCapturePath } from "@apipilot/shared-domain";

/**
 * Extractors and expected-status matching for a Debug run (specs/039-chain-debug-run research R2,
 * R3). A twin of `field`, `headerValue`, `scalarText`, `extracted` and `statusOk` in `CHAIN_RUNTIME`
 * (`backend/src/performance/k6/renderChainScript.ts`): the same inputs give the same pass or fail,
 * and `debugParity.test.ts` holds them to it. What a Debug run adds is the *reason* for a failure,
 * which the runtime collapses into one "failed". The path walk is the runtime's own (it reads own
 * entries, and a numeric part needs an array) and not `valueAtPath` from shared-domain, which differs
 * for a field named like an array position (task T002).
 */

/** The response as extraction sees it. `bodyText` is the whole body decoded as text. */
export interface ExtractionResponse {
  status: number;
  /** A response header by lower-case name, or `undefined`. */
  header(name: string): string | undefined;
  contentType: string | null;
  bodyText: string;
}

export type ParsedBody = { ok: true; value: unknown } | { ok: false };

export function parseJsonBody(bodyText: string): ParsedBody {
  try {
    return { ok: true, value: JSON.parse(bodyText) as unknown };
  } catch {
    return { ok: false };
  }
}

export type WalkResult = { found: true; value: unknown } | { found: false };

/** The runtime's `field()`: own entries only, a numeric part needs an array. */
export function walkBody(root: unknown, path: readonly BodyPathSegment[]): WalkResult {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== "object") return { found: false };
    const numeric = "index" in part;
    if (numeric && !Array.isArray(value)) return { found: false };
    const name = numeric ? String(part.index) : part.field;
    let found = false;
    for (const [key, child] of Object.entries(value)) {
      if (key === name) {
        value = child;
        found = true;
        break;
      }
    }
    if (!found) return { found: false };
  }
  return { found: true, value };
}

/** A non-empty string, a finite number or a boolean, as text; anything else is not a usable value. */
export function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

/** `"200"` matches status 200, `"2XX"` matches 200 to 299. */
export function statusOk(status: number, expected: readonly string[]): boolean {
  const text = String(status);
  for (const code of expected) {
    if (code.length === 3 && code.slice(1) === "XX" ? text.length === 3 && text[0] === code[0] : text === code) return true;
  }
  return false;
}

export type ExtractionResult = { ok: true; value: string } | { ok: false; reason: DebugExtractorFailure };

function kindOf(value: unknown): "object" | "array" | "null" | "empty-text" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "empty-text";
  return "object";
}

/**
 * Runs one extractor. A body extractor takes the already parsed body (`parsed`, parsed once per
 * response by the caller). Extraction is attempted only when the step's status was expected, as in the
 * runtime.
 */
export function extractValue(extractor: Extractor, response: ExtractionResponse, parsed: ParsedBody, statusWasExpected: boolean): ExtractionResult {
  if (!statusWasExpected) return { ok: false, reason: { code: "not-extracted-status" } };
  if (extractor.source.kind === "header") {
    const raw = response.header(extractor.source.name.toLowerCase());
    if (raw === undefined) return { ok: false, reason: { code: "header-missing", header: extractor.source.name } };
    const text = scalarText(raw);
    return text === undefined ? { ok: false, reason: { code: "value-not-scalar", found: "empty-text" } } : { ok: true, value: text };
  }
  const path = extractor.source.path;
  if (!parsed.ok) return { ok: false, reason: { code: "body-not-json", contentType: response.contentType } };
  const segments = parseCapturePath(path);
  if (!segments.ok) return { ok: false, reason: { code: "path-not-found", path } };
  const found = walkBody(parsed.value, segments.segments);
  if (!found.found) return { ok: false, reason: { code: "path-not-found", path } };
  const text = scalarText(found.value);
  if (text === undefined) return { ok: false, reason: { code: "value-not-scalar", found: kindOf(found.value) } };
  return { ok: true, value: text };
}
