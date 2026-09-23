import type {
  ApiModel,
  Environment,
  ExecutionConfirmationRequirement,
  TestModel,
} from "@apipilot/shared-domain";

/**
 * HTTP-method heuristic for which operations count as "destructive" (spec.md Assumptions, v1):
 * any operation whose method plausibly changes server-side state. Exported (specs/026-external-
 * collection-execution research.md D3) so `externalCollections/destructiveRequests.ts` classifies
 * an uploaded collection's own requests against the exact same vocabulary rather than a second,
 * independently-defined set that could silently drift from this one.
 */
export const DESTRUCTIVE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface DestructiveOperation {
  operationPath: string;
  operationMethod: string;
}

/**
 * Every destructive (POST/PUT/PATCH/DELETE) operation in `apiModel` that has at least one approved
 * scenario, once each, in `apiModel` order (specs/029-execution-gap-closure FR-010/FR-011,
 * research.md D6) — the operations the run will actually send, not every operation the
 * specification documents. A synthesized OAuth2 token-fetch POST (specs/024) is excluded without a
 * special case: it is not an operation of the specification and has no approved scenario.
 */
export function destructiveOperations(apiModel: ApiModel, approvedTestModel: TestModel): DestructiveOperation[] {
  const approvedKeys = new Set(
    approvedTestModel.scenarios.map((scenario) => `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`),
  );
  return apiModel.operations
    .filter((operation) => DESTRUCTIVE_METHODS.has(operation.method.toUpperCase()))
    .filter((operation) => approvedKeys.has(`${operation.method.toUpperCase()} ${operation.path}`))
    .map((operation) => ({ operationPath: operation.path, operationMethod: operation.method.toUpperCase() }));
}

/**
 * Whether starting a run against `environment` requires an explicit confirmation (FR-007): the
 * environment's tier is `staging`/`production` (always — specs/029 FR-012), or the approved
 * collection contains at least one destructive operation (specs/029 FR-013). Returns `undefined`
 * when no confirmation is required.
 */
export function confirmationRequirement(
  apiModel: ApiModel,
  approvedTestModel: TestModel,
  environment: Environment,
): ExecutionConfirmationRequirement | undefined {
  const destructive = destructiveOperations(apiModel, approvedTestModel);
  const highRiskTier = environment.tier === "staging" || environment.tier === "production";
  if (!highRiskTier && destructive.length === 0) return undefined;
  return { environmentTier: environment.tier, destructiveOperations: destructive };
}
