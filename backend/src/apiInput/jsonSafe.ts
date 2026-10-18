/**
 * Helpers that keep hostile JSON from consuming unbounded stack or CPU, and that keep dynamic keys
 * from reaching a prototype (specs/056 research R9, R26).
 */

export interface DepthScan {
  /** The deepest container nesting seen, or the first depth that passed `max`. */
  depth: number;
  exceeded: boolean;
}

/**
 * One linear pass over JSON text that tracks `{`/`[` nesting and skips string literals, so a document
 * such as `[[[[…` is refused before `JSON.parse` recurses. Stops as soon as `max` is passed.
 */
export function scanJsonDepth(text: string, max: number): DepthScan {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (char === 0x5c) escaped = true;
      else if (char === 0x22) inString = false;
      continue;
    }
    if (char === 0x22) {
      inString = true;
    } else if (char === 0x7b || char === 0x5b) {
      depth += 1;
      if (depth > deepest) deepest = depth;
      if (depth > max) return { depth, exceeded: true };
    } else if (char === 0x7d || char === 0x5d) {
      depth -= 1;
    }
  }
  return { depth: deepest, exceeded: false };
}

/** An empty record with no prototype, safe for accumulating attacker-chosen keys (`__proto__` is then an ordinary key). */
export function nullProtoRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Copies a record into a plain object so downstream code and serializers see an ordinary shape. */
export function toPlainRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const plain: Record<string, T> = {};
  for (const key of Object.keys(record)) {
    Object.defineProperty(plain, key, { value: record[key], enumerable: true, writable: true, configurable: true });
  }
  return plain;
}

/** Own enumerable entries of a plain object, skipping the `__proto__` key. */
export function ownEntries(value: object): [string, unknown][] {
  return Object.entries(value).filter(([key]) => key !== "__proto__");
}

/** Lets other requests run between slices of a long, linear job (specs/056 SC-009). */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
