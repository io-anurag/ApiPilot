import { child, children, type EsNode } from "./numericGuarantee";

/**
 * The planned length of a user script's own load, when the script states it plainly (the live dashboard's
 * progress bar and time axis; specs/051-user-script-page-redesign FR-004). k6 does not report a planned
 * duration, so this reads the script's text only, never runs it, and answers `null` unless the answer is
 * unambiguous: a top-level `export const options = { ... }` object literal that has no `scenarios`, no
 * `iterations`, no `executor`-style keys, and either a literal `duration` ("30s", "1m30s") or a literal
 * `stages` array whose every `duration` is literal. Anything else (computed values, spread, scenarios,
 * iteration counts, both `duration` and `stages`) is not guessed.
 */

const UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** k6's duration text ("90s", "1h30m", "1.5m", "500ms") in milliseconds, or null when it is not one. */
export function parseK6Duration(text: string): number | null {
  const trimmed = text.trim();
  if (!/^(\d+(\.\d+)?(ms|s|m|h))+$/.test(trimmed)) return null;
  let total = 0;
  for (const part of trimmed.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) total += Number(part[1]) * UNIT_MS[part[2]];
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

function keyName(property: EsNode): string | null {
  if (property.type !== "Property" || property.computed === true) return null;
  const key = child(property, "key");
  if (!key) return null;
  if (key.type === "Identifier") return String(key.name);
  return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
}

function optionsObject(program: EsNode): EsNode | null {
  for (const statement of children(program, "body")) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = child(statement, "declaration");
    if (!declaration || declaration.type !== "VariableDeclaration") continue;
    for (const declarator of children(declaration, "declarations")) {
      const id = child(declarator, "id");
      const init = child(declarator, "init");
      if (id?.type === "Identifier" && id.name === "options" && init?.type === "ObjectExpression") return init;
    }
  }
  return null;
}

function literalDuration(node: EsNode | null): number | null {
  return node && node.type === "Literal" && typeof node.value === "string" ? parseK6Duration(node.value) : null;
}

/** Keys that change when or how long a run lasts in ways a plain `duration` or `stages` does not say. */
const AMBIGUOUS_KEYS = new Set(["scenarios", "iterations", "executor", "maxDuration", "startTime", "gracefulStop", "gracefulRampDown", "setupTimeout"]);

export function plannedDurationOf(program: EsNode): number | null {
  const options = optionsObject(program);
  if (!options) return null;
  const properties = children(options, "properties");
  // A spread or computed key could add anything.
  if (properties.some((property) => property.type !== "Property" || property.computed === true)) return null;
  const names = new Map<string, EsNode>();
  for (const property of properties) {
    const name = keyName(property);
    if (name === null) return null;
    if (AMBIGUOUS_KEYS.has(name)) return null;
    names.set(name, property);
  }
  const duration = names.get("duration");
  const stages = names.get("stages");
  if (duration && stages) return null;
  if (duration) return literalDuration(child(duration, "value"));
  if (!stages) return null;
  const list = child(stages, "value");
  if (!list || list.type !== "ArrayExpression") return null;
  const items = children(list, "elements");
  if (items.length === 0 || items.some((item) => item.type !== "ObjectExpression")) return null;
  let total = 0;
  for (const item of items) {
    const stageProperties = children(item, "properties");
    if (stageProperties.some((property) => property.type !== "Property" || property.computed === true)) return null;
    const stageDuration = stageProperties.find((property) => keyName(property) === "duration");
    const ms = literalDuration(stageDuration ? child(stageDuration, "value") : null);
    if (ms === null) return null;
    total += ms;
  }
  return total;
}
