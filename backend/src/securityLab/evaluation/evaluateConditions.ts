import type { ConditionResult, EvaluationCondition, SecurityScenarioContent } from "@apipilot/shared-domain";
import { PROPERTY_VALUES } from "../execution/probes";
import { looksBinary, parseJsonBody, valuesAtPath } from "./bodyJson";
import { matchesLeakPattern } from "./leakPatterns";
import type { ExecutedResponse } from "./types";

/**
 * One pure evaluator per condition kind (specs/057 contracts/evaluation-and-findings-rules.md "Condition evaluation",
 * research R15). Each returns `satisfied`, `violated` or `indeterminate` from the responses of one scenario, with no
 * model, no clock and no randomness, so evaluating the same evidence twice gives the same answer. A condition that
 * cannot be judged from what was received is `indeterminate`; it is never guessed and never counted as satisfied.
 */

export type ConditionState = ConditionResult["state"];

export interface ConditionInput {
  readonly content: SecurityScenarioContent;
  /** Every response, in the order sent. */
  readonly responses: readonly ExecutedResponse[];
}

const isSuccess = (status: number) => status >= 200 && status < 300;

/** The documented limiting statuses of a scenario, plus 429, which is what a rate limit answers. */
function limitingStatuses(content: SecurityScenarioContent): ReadonlySet<number> {
  return new Set([429, ...(content.expected.documentedStatusCodes ?? [])]);
}

/** "Decisive request": the last request of a single-request scenario, every request of a repeat scenario. */
export function decisiveResponses(content: SecurityScenarioContent, responses: readonly ExecutedResponse[]): readonly ExecutedResponse[] {
  if (responses.length === 0) return [];
  return content.mutations.some((mutation) => mutation.kind === "request.repeat") ? responses : [responses[responses.length - 1]];
}

function allOrNone(decisive: readonly ExecutedResponse[], test: (response: ExecutedResponse) => boolean): ConditionState {
  if (decisive.length === 0) return "indeterminate";
  return decisive.every(test) ? "satisfied" : "violated";
}

function headerOf(response: ExecutedResponse, name: string): string | undefined {
  return response.headers[name.toLowerCase()];
}

/** The value `body.add-property` sent for the property at `path`, so an echo can be recognised. */
function sentPropertyValue(content: SecurityScenarioContent, path: string): unknown {
  for (const mutation of content.mutations) {
    if (mutation.kind !== "body.add-property") continue;
    const full = mutation.path === "" ? mutation.name : `${mutation.path}.${mutation.name}`;
    if (full === path) return PROPERTY_VALUES[mutation.valueKind];
  }
  return undefined;
}

export function evaluateCondition(condition: EvaluationCondition, input: ConditionInput): ConditionState {
  const { content, responses } = input;
  const decisive = decisiveResponses(content, responses);
  const last = decisive.at(-1);

  switch (condition.kind) {
    case "status.not-success":
      if (decisive.length === 0) return "indeterminate";
      return decisive.some((response) => isSuccess(response.status)) ? "violated" : "satisfied";
    case "status.in-set":
      return allOrNone(decisive, (response) => condition.codes.includes(response.status));
    case "status.equals":
      return allOrNone(decisive, (response) => response.status === condition.code);
    case "status.not-equals":
      return allOrNone(decisive, (response) => response.status !== condition.code);

    case "header.present":
      return allOrNone(decisive, (response) => headerOf(response, condition.name) !== undefined);
    case "header.absent":
      return allOrNone(decisive, (response) => headerOf(response, condition.name) === undefined);
    case "header.value-not-contains": {
      if (!last) return "indeterminate";
      const value = headerOf(last, condition.name);
      if (value === undefined) return "indeterminate";
      return value.toLowerCase().includes(condition.token.toLowerCase()) ? "violated" : "satisfied";
    }

    case "body.field-absent":
    case "body.field-present": {
      if (!last) return "indeterminate";
      const body = parseJsonBody(last.bodyText);
      // A body that is empty, not JSON, or cut off before it could be parsed cannot show a field is absent.
      if (body === undefined) return "indeterminate";
      const found = valuesAtPath(body, condition.path).length > 0;
      if (condition.kind === "body.field-present") return found ? "satisfied" : "violated";
      return found ? "violated" : "satisfied";
    }

    case "body.not-match-leak-pattern": {
      if (!last) return "indeterminate";
      if (matchesLeakPattern(condition.patternId, last.bodyText)) return "violated";
      // Absence proves nothing about text that was never read, or that is not text.
      if (looksBinary(last.bodyText) || last.truncated) return "indeterminate";
      return "satisfied";
    }

    case "repeat.limit-engaged": {
      const limiting = limitingStatuses(content);
      const window = responses.slice(0, condition.withinRequests);
      if (window.some((response) => limiting.has(response.status))) return "satisfied";
      // Nothing limited us. That is a finding only if every request of the window was actually answered.
      return window.length >= condition.withinRequests ? "violated" : "indeterminate";
    }

    case "persisted.field-unchanged": {
      if (!last) return "indeterminate";
      // Persisted state is not read back in V1. A refused request persisted nothing, and a response that echoes the
      // value we sent shows it was accepted; an accepted request that does not echo it cannot be judged either way.
      if (!isSuccess(last.status)) return "satisfied";
      const sent = sentPropertyValue(content, condition.path);
      const body = parseJsonBody(last.bodyText);
      if (sent === undefined || body === undefined) return "indeterminate";
      return valuesAtPath(body, condition.path).some((value) => value === sent) ? "violated" : "indeterminate";
    }
  }
}

export function evaluateConditions(input: ConditionInput): ConditionResult[] {
  return input.content.conditions.map((condition) => ({ condition, state: evaluateCondition(condition, input) }));
}
