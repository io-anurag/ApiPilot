import { createHash } from "node:crypto";

/**
 * A SHA-256 over every script an uploaded collection would execute (collection-, folder- and
 * request-level `event` scripts), so the "unverified content" confirmation (FR-007) can be bound to
 * exactly the code that was confirmed — the same idea as the k6 user-script confirmation, which is
 * bound to the script's own hash. Editing, adding, removing or moving any script changes the hash;
 * edits that cannot change what code runs (a URL, a header, a variable value, a rename) do not.
 *
 * Works on the stored JSON directly, not the `postman-collection` object model: the hash must not
 * depend on how the SDK normalizes a document. Malformed JSON hashes to a fixed marker rather than
 * throwing — a stored collection was validated at upload, and an unparseable one never confirms
 * against anything it did not already hash to.
 */

interface RawNode {
  id?: unknown;
  name?: unknown;
  event?: unknown;
  item?: unknown;
}

interface ScriptEntry {
  /** Ancestor ids (or names, or sibling indexes) root first, so a moved script hashes differently. */
  scope: string[];
  listen: string;
  source: string;
}

function scriptSource(script: unknown): string {
  if (typeof script !== "object" || script === null) return "";
  const { exec, src } = script as { exec?: unknown; src?: unknown };
  const code = Array.isArray(exec) ? exec.map(String).join("\n") : typeof exec === "string" ? exec : "";
  return typeof src === "string" && src.length > 0 ? `${code}\n//src:${src}` : code;
}

function collectEvents(node: RawNode, scope: string[], entries: ScriptEntry[]): void {
  if (Array.isArray(node.event)) {
    for (const event of node.event) {
      if (typeof event !== "object" || event === null) continue;
      const { listen, script } = event as { listen?: unknown; script?: unknown };
      const source = scriptSource(script);
      if (source.length === 0) continue;
      entries.push({ scope, listen: typeof listen === "string" ? listen : "", source });
    }
  }
  if (Array.isArray(node.item)) {
    node.item.forEach((child, index) => {
      if (typeof child !== "object" || child === null) return;
      const childNode = child as RawNode;
      const label = typeof childNode.id === "string" ? childNode.id : typeof childNode.name === "string" ? childNode.name : String(index);
      collectEvents(childNode, [...scope, label], entries);
    });
  }
}

export function computeScriptsSha256(rawCollectionJson: string): string {
  const entries: ScriptEntry[] = [];
  try {
    collectEvents(JSON.parse(rawCollectionJson) as RawNode, [], entries);
  } catch {
    return createHash("sha256").update("unparseable-collection").digest("hex");
  }
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
