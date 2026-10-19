import { walkProperties } from "../sensitivity";
import { operationPointer, originOf, type DraftObservation, type ObservationRule } from "./types";

const MAX_PER_OPERATION = 10;

/**
 * `read-only-property-in-request`: a request schema that contains a property the specification marks
 * `readOnly`. It is only a candidate for a property-authorization (mass-assignment) check, never a finding;
 * whether the service accepts such a property is something only a run can show.
 */
export const readOnlyInRequestRule: ObservationRule = {
  id: "read-only-in-request",
  run(context) {
    const drafts: DraftObservation[] = [];
    for (const { operation, key } of context.operations) {
      const seen = new Set<string>();
      for (const schema of Object.values(operation.requestBody?.contentTypes ?? {})) {
        for (const property of walkProperties(schema)) {
          if (property.constraint.readOnly !== true || seen.has(property.path) || seen.size >= MAX_PER_OPERATION) continue;
          seen.add(property.path);
          drafts.push({
            ruleId: "read-only-property-in-request",
            classification: "informational",
            operationKey: key,
            elementPointer: operationPointer(key, `requestBody/${property.path}`),
            rationale: `The request schema includes the property "${property.path}", which the specification marks readOnly. A client should not be able to set it, which makes it a candidate for a mass-assignment check. Only a run can show whether the service ignores or rejects it.`,
            origin: originOf(operation),
            categoryId: "object-property-authorization",
          });
        }
      }
    }
    return drafts;
  },
};
