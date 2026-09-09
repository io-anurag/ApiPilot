import type {
  IntegrationWorkflow,
  WorkflowStep,
  WorkflowVariable,
} from "@apipilot/shared-domain";

export function workflowStep(
  position: number,
  operationMethod: string,
  operationPath: string,
  options: Partial<
    Pick<WorkflowStep, "producesVariableNames" | "consumesVariableNames">
  > = {},
): WorkflowStep {
  return {
    position,
    operationMethod,
    operationPath,
    producesVariableNames: options.producesVariableNames ?? [],
    consumesVariableNames: options.consumesVariableNames ?? [],
  };
}

export function workflowVariable(
  name: string,
  producerStepIndex: number,
  producerField: string,
  consumerStepIndex: number,
  consumerLocation: WorkflowVariable["consumerLocation"],
  consumerField: string,
  relationshipId = `${name}-relationship`,
): WorkflowVariable {
  return {
    name,
    producerStepIndex,
    producerField,
    consumerStepIndex,
    consumerLocation,
    consumerField,
    relationshipId,
  };
}

export function integrationWorkflow(
  id: string,
  steps: WorkflowStep[],
  variables: WorkflowVariable[] = [],
  relationshipIds = variables.map((variable) => variable.relationshipId),
): IntegrationWorkflow {
  return { id, steps, variables, relationshipIds };
}

export function twoStepOrderWorkflow(id = "workflow-order") {
  return integrationWorkflow(id, [
    workflowStep(0, "POST", "/orders/{orderId}"),
    workflowStep(1, "GET", "/orders/{orderId}"),
  ]);
}

export function twoStepHandoffWorkflow(id = "workflow-handoff") {
  const variable = workflowVariable("orderId", 0, "id", 1, "path", "orderId");
  return integrationWorkflow(
    id,
    [
      workflowStep(0, "POST", "/orders/{orderId}", { producesVariableNames: [variable.name] }),
      workflowStep(1, "GET", "/orders/{orderId}", {
        consumesVariableNames: [variable.name],
      }),
    ],
    [variable],
  );
}

export function unsupportedWorkflow(id = "workflow-unsupported") {
  return integrationWorkflow(id, [workflowStep(0, "GET", "/missing")]);
}
