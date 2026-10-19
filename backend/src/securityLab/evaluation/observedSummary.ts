import type { ConditionResult, ObservedSummary, SecurityMutation, SecurityScenarioContent } from "@apipilot/shared-domain";
import { selectResponseHeaders } from "../evidence/excerpt";
import { parseJsonBody, secretLikePaths } from "./bodyJson";
import { decisiveResponses } from "./evaluateConditions";
import { describeCondition } from "./scenarioOutcome";
import type { ExecutedResponse } from "./types";

/**
 * The observed summary kept with a result and an occurrence (specs/057 data-model section 6, research R13 and R14).
 * It is deterministic, bounded and retained, and it is built from the status, a fixed set of header names with
 * redacted values and a sentence naming the decisive condition. It **never** contains a body excerpt: a secret-shaped
 * value is described as "secret-like value present at <path>" and the value itself is never read into the summary.
 */

const MAX_STATEMENT = 400;
const MAX_REPORTED_PATHS = 3;

function context(mutations: readonly SecurityMutation[]): string {
  const byKind = (kind: SecurityMutation["kind"]) => mutations.find((mutation) => mutation.kind === kind);
  if (byKind("path-id.substitute")) return " for another identity's resource";
  if (byKind("auth.omit")) return " for a request without credentials";
  if (byKind("auth.invalid-token")) return " for a request with an invalid token";
  if (byKind("auth.malformed")) return " for a request with a malformed credential";
  if (byKind("auth.expired")) return " for a request with an expired credential";
  if (byKind("identity.swap")) return " for a request made as another identity";
  if (byKind("body.add-property")) return " for a request that sets a protected property";
  if (byKind("field.violate-constraint")) return " for a request that breaks a declared constraint";
  if (byKind("input.injection-probe")) return " for a request carrying a probe value";
  const probe = byKind("method.probe");
  if (probe?.kind === "method.probe") return ` for a ${probe.method} request`;
  const repeat = byKind("request.repeat");
  if (repeat?.kind === "request.repeat") return ` after ${repeat.count} repeated requests`;
  return "";
}

function bounded(text: string): string {
  return text.length <= MAX_STATEMENT ? text : `${text.slice(0, MAX_STATEMENT - 1)}…`;
}

export function buildObservedSummary(
  content: SecurityScenarioContent,
  responses: readonly ExecutedResponse[],
  results: readonly ConditionResult[],
  secrets: readonly string[],
): ObservedSummary {
  const last = responses.at(-1);
  if (!last) return { responseHeadersSelected: {}, statement: "No response was received.", truncated: false };

  let statement = `Status ${last.status}${context(content.mutations)}.`;
  const decisive = results.find((result) => result.state === "violated") ?? results.find((result) => result.state === "indeterminate");
  if (decisive) statement += ` ${decisive.state === "violated" ? "Violated" : "Not judged"}: ${describeCondition(decisive.condition)}.`;

  const body = parseJsonBody(last.bodyText);
  const paths = body === undefined ? [] : secretLikePaths(body);
  if (paths.length > 0) statement += ` Secret-like value present at ${paths.slice(0, MAX_REPORTED_PATHS).join(", ")}${paths.length > MAX_REPORTED_PATHS ? " and others" : ""}.`;

  const truncated = decisiveResponses(content, responses).some((response) => response.truncated);
  return { responseStatus: last.status, responseHeadersSelected: selectResponseHeaders(last.headers, secrets), statement: bounded(statement), truncated };
}
