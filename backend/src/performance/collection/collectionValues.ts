import { compareCodeUnits } from "../../postman/ordering";

/**
 * AP-036 (specs/036-collection-performance-test research R11, R12): the collection's base URL
 * variable, written as `{{baseUrl}}` when a collection seeds a request-chain plan
 * (specs/037-request-chain-performance FR-024). Pure; no value is read here, only the collection's
 * text.
 */
export const BASE_URL = "baseUrl";

/** The `{{name}}` a URL starts with, or `null`. */
function leadingVariable(url: string): string | null {
  return /^\{\{([^{}]+)\}\}/.exec(url)?.[1] ?? null;
}

/**
 * R12: the leading `{{name}}` of the most selected requests' URLs; a tie goes to the first in
 * code-unit order. `null` when no URL starts with a variable.
 */
export function baseUrlVariableOf(urls: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const name = leadingVariable(url);
    if (name !== null) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [name, count] of [...counts].sort(([a], [b]) => compareCodeUnits(a, b))) {
    if (best === null || count > counts.get(best)!) best = name;
  }
  return best;
}

/** R11: the leading base-URL variable written as `{{baseUrl}}`, the one name the runtime leaves unencoded. */
export function withBaseUrl(url: string, baseUrlVariable: string | null): string {
  if (baseUrlVariable === null || leadingVariable(url) !== baseUrlVariable) return url;
  return `{{${BASE_URL}}}${url.slice(baseUrlVariable.length + 4)}`;
}
