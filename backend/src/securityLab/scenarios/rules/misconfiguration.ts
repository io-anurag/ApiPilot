import type { ApiOperation, EvaluationCondition, SecurityMutation } from "@apipilot/shared-domain";
import { operationKeyOf } from "../../analysis/effectiveSecurity";
import { isStateChangingMethod } from "../../analysis/sensitivity";
import { primaryRequestBodySchema, walkFields } from "../../../testDesign/requestHelpers";
import { isCredentialFieldName } from "../credentialPlaceholders";
import { ROLE_ANY, identityPrerequisite } from "../prerequisites";
import { productRuleStatement } from "../productRules";
import { formatTarget } from "../requestTarget";
import { suggestedSeverityFor } from "../suggestedSeverity";
import { violationFor } from "../violations";
import { NO_OUTPUT, makeContent, primaryScheme, requirementOf, type GenerationContext, type RuleOutput, type ScenarioRule } from "./support";

/** The order methods are tried in when picking the one operation of a path that carries the TRACE probe. */
const METHOD_ORDER = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "TRACE"];

function isFirstOperationOfPath(context: GenerationContext, operation: ApiOperation): boolean {
  const siblings = context.apiModel.operations.filter((candidate) => candidate.path === operation.path);
  const rank = (candidate: ApiOperation) => {
    const index = METHOD_ORDER.indexOf(candidate.method.toUpperCase());
    return index === -1 ? METHOD_ORDER.length : index;
  };
  const first = [...siblings].sort((a, b) => rank(a) - rank(b) || a.method.localeCompare(b.method))[0];
  return first === operation;
}

const LEAK_CONDITIONS: EvaluationCondition[] = [
  { kind: "body.not-match-leak-pattern", patternId: "stack-trace" },
  { kind: "body.not-match-leak-pattern", patternId: "internal-path" },
  { kind: "body.not-match-leak-pattern", patternId: "sql-error" },
  { kind: "body.not-match-leak-pattern", patternId: "server-banner" },
];

/**
 * Security misconfiguration and error handling (specs/057 FR-025). Two checks the specification and the model can
 * support:
 *
 * - A **TRACE probe**, once per path whose specification does not document TRACE. TRACE is a read-only echo
 *   method, so the probe never changes data whatever the operation's own method is. It is expected not to succeed.
 * - An **error-leak check** on an operation with a request body: a request with one field of the wrong type must not
 *   make the error response reveal a stack trace, an internal path, a SQL error or a server banner.
 *
 * Response-header checks are not generated: the model records no response headers, so there is nothing documented to
 * check. That is stated as a limitation, not hidden.
 */
export const misconfigurationRule: ScenarioRule = {
  id: "security-misconfiguration",
  categoryId: "security-misconfiguration",
  run(context, operation): RuleOutput {
    const key = operationKeyOf(operation);
    const contents = [];

    const documentsTrace = context.apiModel.operations.some((candidate) => candidate.path === operation.path && candidate.method.toUpperCase() === "TRACE");
    if (isFirstOperationOfPath(context, operation) && !documentsTrace) {
      const mutation: SecurityMutation = { kind: "method.probe", method: "TRACE" };
      const { requiresCredentials, schemes } = requirementOf(context, operation);
      const scheme = requiresCredentials ? primaryScheme(context, schemes) : undefined;
      contents.push(
        makeContent({
          context,
          operation,
          categoryId: "security-misconfiguration",
          ruleId: "security-misconfiguration.trace-probe",
          title: `${operation.path} answers TRACE`,
          objective: "Check that the service does not enable the TRACE method on this path.",
          rationale: "The specification does not document TRACE for this path. TRACE echoes a request back to the caller and is normally switched off, so the probe should not succeed.",
          impact: "An enabled TRACE method can help an attacker read headers a script should not see.",
          mutations: [mutation],
          expected: { kind: "rejected", statement: productRuleStatement("SL-REJECT-UNDOCUMENTED-METHOD"), basis: "product-rule", ruleId: "SL-REJECT-UNDOCUMENTED-METHOD" },
          conditions: [{ kind: "status.not-success" }],
          severity: suggestedSeverityFor("security-misconfiguration", "method.probe", false),
          specElementPointer: `/paths/${operation.path}`,
          limitations: ["TRACE is a read-only method, so this probe never changes data."],
          ...(scheme
            ? { prerequisites: [identityPrerequisite(ROLE_ANY, scheme)], requiredIdentities: [{ role: ROLE_ANY, label: "An identity allowed to call the path" }] }
            : {}),
        }),
      );
    }

    if (isStateChangingMethod(operation.method)) {
      const body = primaryRequestBodySchema(operation);
      const field = body
        ? [...walkFields(body)].find(
            (entry) => !isCredentialFieldName(entry.path.split(".").at(-1) ?? entry.path) && violationFor(entry.schema, "type") !== undefined,
          )
        : undefined;
      if (field) {
        const { requiresCredentials, schemes } = requirementOf(context, operation);
        const scheme = requiresCredentials ? primaryScheme(context, schemes) : undefined;
        if (!requiresCredentials || scheme) {
          contents.push(
            makeContent({
              context,
              operation,
              categoryId: "security-misconfiguration",
              ruleId: "security-misconfiguration.error-leak",
              title: `${key}: an error response must not leak internals`,
              objective: "Check that the error response to a malformed request does not reveal a stack trace, an internal path, a SQL error or a server banner.",
              rationale: `A request in which "${field.path}" has the wrong type should be rejected with a plain error. Error text that reveals internals helps an attacker and points to unhandled errors.`,
              impact: "Verbose error responses disclose implementation details an attacker can use.",
              mutations: [{ kind: "field.violate-constraint", path: formatTarget("body", field.path), constraint: "type" }],
              expected: { kind: "no-leak", statement: productRuleStatement("SL-NO-LEAK-PATTERN"), basis: "product-rule", ruleId: "SL-NO-LEAK-PATTERN" },
              conditions: LEAK_CONDITIONS,
              severity: suggestedSeverityFor("security-misconfiguration", "field.violate-constraint", true),
              specElementPointer: `/operations/${key}/requestBody/${field.path}`,
              limitations: ["Response-header checks are not generated because the model records no response headers."],
              ...(scheme
                ? { prerequisites: [identityPrerequisite(ROLE_ANY, scheme)], requiredIdentities: [{ role: ROLE_ANY, label: "An identity allowed to call the operation" }] }
                : {}),
            }),
          );
        }
      }
    }

    return contents.length === 0 ? NO_OUTPUT : { contents, notes: [] };
  },
};
