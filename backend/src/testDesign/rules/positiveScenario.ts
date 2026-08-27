import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { selectPositiveAssertions } from "../assertions";
import { buildConformantRequest } from "../requestHelpers";
import { buildScenario } from "../scenario";

/** Generates one happy-path scenario per operation using specification-conformant values (FR-001). */
export function positiveScenario(operation: ApiOperation): TestScenario[] {
  return [
    buildScenario({
      operation,
      category: "positive",
      request: buildConformantRequest(operation),
      assertionResult: selectPositiveAssertions(operation),
      rule: "positive-scenario",
      description: "Happy-path request using specification-conformant values.",
    }),
  ];
}
