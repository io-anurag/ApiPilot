import type { GeneratedRequest, TestScenario, WorkflowVariable } from "@apipilot/shared-domain";
import { workflowVariableName } from "./workflowRendering";

export interface WorkflowSubstitution {
  variable: WorkflowVariable;
  variableName: string;
}

function setDottedValue(target: Record<string, unknown>, field: string, value: string): void {
  const parts = field.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const nested = current[part];
    if (typeof nested !== "object" || nested === null || Array.isArray(nested)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function applyWorkflowSubstitutions(
  scenario: TestScenario,
  workflowId: string,
  variables: WorkflowVariable[],
): TestScenario {
  const request: GeneratedRequest = {
    pathParameters: { ...scenario.request.pathParameters },
    queryParameters: { ...scenario.request.queryParameters },
    headers: { ...scenario.request.headers },
    ...(scenario.request.body === undefined ? {} : { body: structuredClone(scenario.request.body) }),
  };
  for (const variable of variables) {
    const value = `{{${workflowVariableName(workflowId, variable.name)}}}`;
    if (variable.consumerLocation === "path") request.pathParameters[variable.consumerField] = value;
    if (variable.consumerLocation === "query") request.queryParameters[variable.consumerField] = value;
    if (variable.consumerLocation === "header") request.headers[variable.consumerField] = value;
    if (variable.consumerLocation === "body") {
      setDottedValue(request.body as Record<string, unknown>, variable.consumerField, value);
    }
  }
  return { ...scenario, request };
}
