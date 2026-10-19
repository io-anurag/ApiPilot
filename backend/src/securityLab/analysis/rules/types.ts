import type { ApiModel, ApiOperation, EffectiveSecurity, FactOrigin, SecurityObservation } from "@apipilot/shared-domain";
import { operationKeyOf } from "../effectiveSecurity";

/** Everything an observation rule may read. Rules are pure functions of this context (specs/057 FR-005). */
export interface AnalysisContext {
  readonly apiModel: ApiModel;
  /** Effective security by operation key. */
  readonly effective: ReadonlyMap<string, EffectiveSecurity>;
  readonly operations: ReadonlyArray<{ readonly operation: ApiOperation; readonly key: string }>;
  /** Sensitive field names the user configured, lowercase. Recorded as user-provided, never as fact. */
  readonly configuredSensitive: ReadonlySet<string>;
}

/** An observation before the analyzer assigns its stable id. */
export type DraftObservation = Omit<SecurityObservation, "id">;

export interface ObservationRule {
  readonly id: string;
  run(context: AnalysisContext): DraftObservation[];
}

export function buildContext(
  apiModel: ApiModel,
  effective: readonly EffectiveSecurity[],
  configuredSensitive: ReadonlySet<string>,
): AnalysisContext {
  return {
    apiModel,
    effective: new Map(effective.map((entry) => [entry.operationKey, entry])),
    operations: apiModel.operations.map((operation) => ({ operation, key: operationKeyOf(operation) })),
    configuredSensitive,
  };
}

/** The origin of the model fact an observation about an operation rests on. Absent provenance means documented. */
export function originOf(operation: ApiOperation): FactOrigin {
  return operation.provenance?.origin ?? "documented";
}

/** A pointer into the model for an operation element, for the "source specification element" of an observation. */
export function operationPointer(key: string, element: string): string {
  return `/operations/${key}/${element}`;
}
