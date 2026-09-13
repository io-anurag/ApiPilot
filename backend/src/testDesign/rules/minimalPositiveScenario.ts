import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { selectPositiveAssertions } from "../assertions";
import { buildMinimalConformantRequest, hasOmittableOptionalInput } from "../requestHelpers";
import { buildScenario } from "../scenario";

/**
 * Generates a second happy-path scenario per operation, using only the fields/parameters the
 * specification actually requires (every optional body field and optional query/header
 * parameter omitted) — exercising the equally valid case where a caller supplies the minimum
 * the specification demands. Skipped when there is nothing optional to omit, since the result
 * would otherwise be identical to `positiveScenario` and dedup away.
 */
export function minimalPositiveScenario(operation: ApiOperation): TestScenario[] {
  if (!hasOmittableOptionalInput(operation)) return [];
  return [
    buildScenario({
      operation,
      category: "positive",
      request: buildMinimalConformantRequest(operation),
      assertionResult: selectPositiveAssertions(operation),
      rule: "minimal-positive-scenario",
      description: "Happy-path request using only specification-required fields; optional fields omitted.",
    }),
  ];
}
