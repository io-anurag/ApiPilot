import type { GeneratableCategoryId, SecurityScenarioContent } from "@apipilot/shared-domain";

/**
 * Per-operation caps on generated scenarios (specs/057 contracts/generation-and-analysis-rules.md section 6,
 * constitution XII). They keep a specification of 50 operations to a reviewable number of scenarios, and the
 * result says exactly what a cap omitted. The caps are fixed and documented here; they are never silently applied.
 */

/** A cap group: usually the category, with injection probes counted apart so they are not crowded out by constraint violations. */
function groupOf(content: SecurityScenarioContent): string {
  return content.provenance.ruleId?.startsWith("input-validation.injection-probe") ? "input-validation.injection" : content.categoryId;
}

export const PER_OPERATION_CAPS: Readonly<Record<GeneratableCategoryId | "input-validation.injection", number>> = {
  authentication: 4,
  authorization: 1,
  "broken-object-level-authorization": 1,
  "object-property-authorization": 3,
  "input-validation": 10,
  "input-validation.injection": 2,
  "resource-consumption": 1,
  "sensitive-data-exposure": 1,
  "security-misconfiguration": 2,
  "sensitive-business-flows": 0,
};

export interface CapOmission {
  readonly operationKey: string;
  readonly categoryId: GeneratableCategoryId;
  readonly omitted: number;
}

/** Keeps the first `cap` scenarios of each operation and group, in the order given, and reports what was left out. */
export function applyCaps<T extends { content: SecurityScenarioContent }>(items: readonly T[]): { kept: T[]; omissions: CapOmission[] } {
  const seen = new Map<string, number>();
  const omitted = new Map<string, CapOmission>();
  const kept: T[] = [];
  for (const item of items) {
    const group = groupOf(item.content);
    const key = `${item.content.operationKey}|${group}`;
    const used = seen.get(key) ?? 0;
    const cap = PER_OPERATION_CAPS[group as keyof typeof PER_OPERATION_CAPS] ?? 0;
    if (used < cap) {
      seen.set(key, used + 1);
      kept.push(item);
    } else {
      const previous = omitted.get(key);
      omitted.set(key, {
        operationKey: item.content.operationKey,
        categoryId: item.content.categoryId,
        omitted: (previous?.omitted ?? 0) + 1,
      });
    }
  }
  return { kept, omissions: [...omitted.values()] };
}
