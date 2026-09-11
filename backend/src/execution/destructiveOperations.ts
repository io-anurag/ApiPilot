import type {
  ApiModel,
  Environment,
  ExecutionConfirmationRequirement,
} from "@apipilot/shared-domain";

/**
 * HTTP-method heuristic for which operations count as "destructive" (spec.md Assumptions, v1):
 * any operation whose method plausibly changes server-side state.
 */
const DESTRUCTIVE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface DestructiveOperation {
  operationPath: string;
  operationMethod: string;
}

/** Every operation in `apiModel` whose method is destructive (POST/PUT/PATCH/DELETE). */
export function destructiveOperations(apiModel: ApiModel): DestructiveOperation[] {
  return apiModel.operations
    .filter((operation) => DESTRUCTIVE_METHODS.has(operation.method.toUpperCase()))
    .map((operation) => ({ operationPath: operation.path, operationMethod: operation.method.toUpperCase() }));
}

/**
 * Whether starting a run against `environment` requires an explicit confirmation (FR-007): the
 * environment's tier is `staging`/`production`, or the approved collection contains at least one
 * destructive operation. Returns `undefined` when no confirmation is required.
 */
export function confirmationRequirement(
  apiModel: ApiModel,
  environment: Environment,
): ExecutionConfirmationRequirement | undefined {
  const destructive = destructiveOperations(apiModel);
  const highRiskTier = environment.tier === "staging" || environment.tier === "production";
  if (!highRiskTier && destructive.length === 0) return undefined;
  return { environmentTier: environment.tier, destructiveOperations: destructive };
}
