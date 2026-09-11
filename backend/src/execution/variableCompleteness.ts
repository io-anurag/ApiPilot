import type { PostmanCollectionVariable } from "@apipilot/shared-domain";

/** Always separately supplied via `Environment.baseUrl` — never counted as "missing" (FR-004). */
const BASE_URL_VARIABLE = "baseUrl";

/**
 * Every declared collection variable (excluding `baseUrl`) the given environment does not supply
 * a non-empty value for (FR-004). An empty string counts as missing: a credential-like variable
 * left blank is not meaningfully "supplied".
 */
export function missingVariableValues(
  declaredVariables: PostmanCollectionVariable[],
  variableValues: Record<string, string>,
): string[] {
  return declaredVariables
    .map((variable) => variable.key)
    .filter((name) => name !== BASE_URL_VARIABLE)
    .filter((name) => !variableValues[name]);
}
