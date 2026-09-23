/**
 * Shared, behavior-preserving repairs for JSON returned by a chat model. Used by every AI feature
 * that parses a structured response (AP-005 scenarios, AP-008 dependencies, AP-031 failure
 * analysis), so the repair rules cannot drift between them.
 */

/**
 * Strips a markdown code fence around an otherwise-valid JSON document.
 *
 * Instruction-tuned chat models very commonly wrap JSON in ```json fences regardless of being
 * asked not to — measured directly against the default model, which produced a correct document
 * inside a fence. Removing a wrapper is a safe repair in the sense constitution IV intends: it
 * discards no content and changes no value, it only unwraps. Anything beyond this stays a
 * rejection, because guessing at malformed content is how fabricated test data gets in.
 */
export function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const closingIndex = withoutOpening.lastIndexOf("```");
  return (
    closingIndex === -1 ? withoutOpening : withoutOpening.slice(0, closingIndex)
  ).trim();
}

/** Returns a balanced JSON object beginning at `start`, if one exists. */
function balancedObjectAt(content: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return content.slice(start, index + 1);
    }
  }
  return undefined;
}

/** Extracts every balanced JSON object from a model response with surrounding prose. */
export function extractJsonObjects(content: string): string[] {
  const objects: string[] = [];
  for (
    let start = content.indexOf("{");
    start >= 0;
    start = content.indexOf("{", start + 1)
  ) {
    const object = balancedObjectAt(content, start);
    if (object) objects.push(object);
  }
  return objects;
}
