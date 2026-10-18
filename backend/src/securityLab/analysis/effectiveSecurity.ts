import type { ApiModel, ApiOperation, EffectiveSecurity } from "@apipilot/shared-domain";

/**
 * Resolves what security applies to each operation (specs/057 FR-006, contracts/generation-and-analysis-rules.md
 * section 1). The OpenAPI builder already applied inheritance: `operation.security` is the effective list, an own
 * `security: []` winning over the root. What it could not keep is *how* that list was reached, which is why the
 * model carries `securitySource`. An operation with no explicit requirement is never called unprotected here: it may
 * inherit the root requirement or be public on purpose.
 */

export function operationKeyOf(operation: Pick<ApiOperation, "method" | "path">): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

export function resolveEffectiveSecurity(apiModel: ApiModel): EffectiveSecurity[] {
  const rootEmpty = apiModel.rootSecurityDeclared === true && (apiModel.rootSecurity?.length ?? 0) === 0;
  return apiModel.operations.map((operation) => {
    const source = operation.securitySource ?? "unknown";
    return {
      operationKey: operationKeyOf(operation),
      requirement: operation.security.map((entry) => ({
        schemes: entry.schemes.map((scheme) => ({ name: scheme.name, scopes: [...scheme.scopes] })),
      })),
      source,
      rootExplicitlyEmpty: rootEmpty && source === "none-declared",
    };
  });
}

/** Names of the schemes any alternative of a requirement list uses. */
export function schemeNamesOf(requirement: EffectiveSecurity["requirement"]): string[] {
  return [...new Set(requirement.flatMap((entry) => entry.schemes.map((scheme) => scheme.name)))].sort();
}

/** True when the requirement list contains the anonymous alternative `{}`, which allows an unauthenticated call. */
export function allowsAnonymous(requirement: EffectiveSecurity["requirement"]): boolean {
  return requirement.some((entry) => entry.schemes.length === 0);
}

/** A short plain-language form of a requirement list, for rationale text. */
export function describeRequirement(requirement: EffectiveSecurity["requirement"]): string {
  if (requirement.length === 0) return "no requirement";
  return requirement
    .map((entry) => (entry.schemes.length === 0 ? "no credential (anonymous allowed)" : entry.schemes.map((scheme) => scheme.name).join(" and ")))
    .join(" or ");
}
