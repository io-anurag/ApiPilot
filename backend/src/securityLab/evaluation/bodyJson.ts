import { classifyValue } from "../../apiInput/redaction";
import { isSensitiveFieldName } from "../../testDesign/sensitiveValueDetection";

/**
 * Reading a response body for evaluation. Bodies come from an arbitrary target, so every function is bounded, never
 * throws, and never returns the value it found: a caller learns **where** something is, not what it is (R14).
 */

export const MAX_JSON_DEPTH = 32;
const MAX_NODES = 5_000;

/** The parsed body, or undefined when it is empty or not JSON. */
export function parseJsonBody(text: string): unknown | undefined {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Whether `text` looks binary (it holds a NUL or a replacement character from a failed decode). */
export function looksBinary(text: string): boolean {
  return text.includes("\u0000") || text.includes("�");
}

/** The segments of a dotted path, accepting a leading `$.` and `[]`/`[n]` markers as "any element". */
export function pathSegments(path: string): string[] {
  const trimmed = path.startsWith("$.") ? path.slice(2) : path === "$" ? "" : path;
  return trimmed
    .replaceAll(/\[\d*\]/g, "")
    .split(".")
    .filter((segment) => segment !== "");
}

/**
 * Looks a path up in a parsed body. An array met on the way is searched element by element, so `items.id` is found
 * when any item has an `id`. Returns every value found at the path, in document order.
 */
export function valuesAtPath(root: unknown, path: string): unknown[] {
  let level: unknown[] = [root];
  for (const segment of pathSegments(path)) {
    const next: unknown[] = [];
    for (const node of level) {
      const candidates = Array.isArray(node) ? node : [node];
      for (const candidate of candidates) {
        if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) && Object.hasOwn(candidate, segment)) {
          next.push((candidate as Record<string, unknown>)[segment]);
        }
      }
    }
    level = next;
    if (level.length === 0) return [];
  }
  return level;
}

/**
 * The JSON paths (`$.a.b`) that hold a secret-like value: a string that is a credential by its shape, or any non-empty
 * string under a field whose name marks it as a credential. Never returns a value. Bounded in depth and node count.
 */
export function secretLikePaths(root: unknown): string[] {
  const found: string[] = [];
  let visited = 0;
  const visit = (node: unknown, path: string, name: string, depth: number): void => {
    if (visited++ > MAX_NODES || depth > MAX_JSON_DEPTH) return;
    if (typeof node === "string") {
      if (node !== "" && (classifyValue(node) !== undefined || (isSensitiveFieldName(name) && node !== "[redacted]"))) found.push(path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`, name, depth + 1));
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) visit(child, `${path}.${key}`, key, depth + 1);
    }
  };
  visit(root, "$", "", 0);
  return found;
}
