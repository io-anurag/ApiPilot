import type { ConditionResult, ConfidenceLevel, SecurityScenarioContent } from "@apipilot/shared-domain";
import { decisiveResponses } from "./evaluateConditions";
import type { ExecutedResponse } from "./types";

/**
 * Confidence in a failed result (specs/057 contracts/evaluation-and-findings-rules.md "Confidence"). It is computed from
 * the evidence and the scenario's grounding, never assigned by a model, and it records its basis in words.
 *
 *   low     a violation seen only across repeated requests, evidence cut off near the decisive part, or a persisted
 *           state check that has no stable read behind it
 *   high    the expectation is documented in the specification and one unambiguous response violates it
 *   medium  the expectation is a named product rule and one clear response violates it
 */
export interface Confidence {
  readonly level: ConfidenceLevel;
  readonly basis: string;
}

export function confidenceFor(content: SecurityScenarioContent, responses: readonly ExecutedResponse[], results: readonly ConditionResult[]): Confidence {
  const violated = results.filter((result) => result.state === "violated");
  const decisive = decisiveResponses(content, responses);
  const last = decisive.at(-1);

  if (content.mutations.some((mutation) => mutation.kind === "request.repeat")) {
    return { level: "low", basis: `The violation shows only across ${responses.length} repeated requests, not in a single response.` };
  }
  if (decisive.some((response) => response.truncated)) {
    return { level: "low", basis: "The response was cut off at the read limit, close to the part that decided the result." };
  }
  if (violated.some((result) => result.condition.kind === "persisted.field-unchanged")) {
    return { level: "low", basis: "Persisted state is not read back in this version. The response echoed the value that was sent, which suggests it was accepted but is not proof it was stored." };
  }

  const observed = last ? `status ${last.status}` : "the response";
  if (content.expected.basis === "documented") {
    const codes = content.expected.documentedStatusCodes;
    const documented = codes && codes.length > 0 ? `the documented ${codes.length === 1 ? "status" : "statuses"} ${codes.join(", ")}` : "the documented response";
    return { level: "high", basis: `The specification documents ${documented}, and the single response was ${observed}.` };
  }
  return { level: "medium", basis: `The expectation is the product rule ${content.expected.ruleId ?? "of this scenario"}, and the single response was ${observed}.` };
}
