import type {
  ApiModel,
  ApiOperation,
  GenerationLimitation,
  IntegrationWorkflow,
  TestModel,
  TestScenario,
  WorkflowExportContext,
  WorkflowStep,
  WorkflowVariable,
} from "@apipilot/shared-domain";
import { compareCodeUnits } from "./ordering";
import { mapOperationAuth } from "./authMapping";
import { primaryRequestBodyContentType } from "../testDesign/requestHelpers";

export interface WorkflowRenderStep {
  position: number;
  scenario: TestScenario;
  operation: ApiOperation;
  produces: WorkflowVariable[];
  consumes: WorkflowVariable[];
}

export interface WorkflowRenderPlan {
  workflowId: string;
  steps: WorkflowRenderStep[];
  variables: WorkflowVariable[];
  limitation?: GenerationLimitation;
}

export interface WorkflowRenderPlans {
  plans: WorkflowRenderPlan[];
  renderedScenarioIds: Set<string>;
  limitations: GenerationLimitation[];
  approvedWorkflowCount: number;
  unsupportedWorkflowCount: number;
  omittedWorkflowCount: number;
}

function operationKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function safeWorkflowName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_");
}

export function workflowVariableName(workflowId: string, variableName: string): string {
  return `${safeWorkflowName(workflowId)}_${safeWorkflowName(variableName)}`;
}

function workflowLimitation(
  workflow: IntegrationWorkflow,
  kind: GenerationLimitation["kind"],
  message: string,
  step?: WorkflowStep,
  relationshipId?: string,
): GenerationLimitation {
  return {
    kind,
    workflowId: workflow.id,
    stepPosition: step?.position,
    relationshipId,
    location: `workflow ${workflow.id}${step ? ` step ${step.position}` : ""}`,
    message,
  };
}

function selectScenario(scenarios: TestScenario[], step: WorkflowStep): TestScenario | undefined {
  return [...scenarios]
    .filter(
      (scenario) =>
        operationKey(scenario.operationPath, scenario.operationMethod) ===
        operationKey(step.operationPath, step.operationMethod),
    )
    .sort(
      (left, right) =>
        Number(right.category === "positive") - Number(left.category === "positive") ||
        compareCodeUnits(left.id, right.id),
    )[0];
}

function supportedField(field: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(field);
}

function invalidPlan(
  workflow: IntegrationWorkflow,
  limitation: GenerationLimitation,
): WorkflowRenderPlan {
  return { workflowId: workflow.id, steps: [], variables: [], limitation };
}

function planWorkflow(
  workflow: IntegrationWorkflow,
  apiModel: ApiModel,
  testModel: TestModel,
): WorkflowRenderPlan {
  const sortedSteps = [...workflow.steps].sort((left, right) => left.position - right.position);
  if (
    sortedSteps.length === 0 ||
    sortedSteps.some((step, index) => step.position !== index) ||
    new Set(sortedSteps.map((step) => step.position)).size !== sortedSteps.length
  ) {
    return invalidPlan(
      workflow,
      workflowLimitation(
        workflow,
        "workflow-unsupported-sequence",
        "The workflow steps do not have a unique contiguous order, so no sequence was emitted.",
      ),
    );
  }

  const operations = new Map(
    apiModel.operations.map((operation) => [operationKey(operation.path, operation.method), operation]),
  );
  const steps: WorkflowRenderStep[] = [];
  for (const step of sortedSteps) {
    const operation = operations.get(operationKey(step.operationPath, step.operationMethod));
    if (!operation) {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-unsupported-sequence",
          "A workflow step references an operation that is absent from the analyzed API model.",
          step,
        ),
      );
    }
    const scenario = selectScenario(testModel.scenarios, step);
    if (!scenario) {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-missing-scenario",
          "The workflow step has no approved scenario for its operation, so no partial sequence was emitted.",
          step,
        ),
      );
    }
    steps.push({ position: step.position, scenario, operation, produces: [], consumes: [] });
  }

  const byPosition = new Map(steps.map((step) => [step.position, step]));
  const variables = [...workflow.variables].sort((left, right) => compareCodeUnits(left.name, right.name));
  for (const variable of variables) {
    const producer = byPosition.get(variable.producerStepIndex);
    const consumer = byPosition.get(variable.consumerStepIndex);
    if (!producer || !consumer || variable.producerStepIndex >= variable.consumerStepIndex) {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-unresolved-handoff",
          "A workflow handoff does not identify an earlier producer and later consumer step.",
          producer ? sortedSteps[producer.position] : undefined,
          variable.relationshipId,
        ),
      );
    }
    if (!supportedField(variable.producerField)) {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-unsupported-extraction-path",
          "A workflow handoff uses a response field path that this exporter cannot represent.",
          sortedSteps[variable.producerStepIndex],
          variable.relationshipId,
        ),
      );
    }
    if (!supportedField(variable.consumerField)) {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-unresolved-handoff",
          "A workflow handoff uses a request field path that this exporter cannot represent.",
          sortedSteps[variable.consumerStepIndex],
          variable.relationshipId,
        ),
      );
    }
    if (!consumer.scenario.request.body && variable.consumerLocation === "body") {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-unresolved-handoff",
          "The consuming workflow step has no approved request body in which to place the handoff.",
          sortedSteps[variable.consumerStepIndex],
          variable.relationshipId,
        ),
      );
    }
    producer.produces.push(variable);
    consumer.consumes.push(variable);
  }

  for (const step of steps) {
    const bodyContentType = primaryRequestBodyContentType(step.operation);
    if (
      step.scenario.request.body !== undefined &&
      bodyContentType !== undefined &&
      !/^application\/(json|[\w.+-]*\+json)$/i.test(bodyContentType) &&
      !/^text\//i.test(bodyContentType)
    ) {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-unsupported-request-representation",
          `The workflow step uses request content type "${bodyContentType}", which this exporter cannot represent faithfully.`,
          sortedSteps[step.position],
        ),
      );
    }
    const authLimitations = mapOperationAuth(step.operation, apiModel.securitySchemes).limitations;
    if (authLimitations.some((limitation) => limitation.kind === "unsupported-auth-scheme")) {
      return invalidPlan(
        workflow,
        workflowLimitation(
          workflow,
          "workflow-unsupported-request-representation",
          "The workflow step requires an authentication scheme that this exporter cannot represent faithfully.",
          sortedSteps[step.position],
        ),
      );
    }
  }

  return { workflowId: workflow.id, steps, variables };
}

export function planApprovedWorkflows(
  apiModel: ApiModel,
  testModel: TestModel,
  context?: WorkflowExportContext,
): WorkflowRenderPlans {
  if (!context) {
    return {
      plans: [],
      renderedScenarioIds: new Set(),
      limitations: [],
      approvedWorkflowCount: 0,
      unsupportedWorkflowCount: 0,
      omittedWorkflowCount: 0,
    };
  }
  const workflows = [...context.workflows].sort((left, right) => compareCodeUnits(left.id, right.id));
  const approved = new Set(context.approvedWorkflowIds);
  const plans = workflows.filter((workflow) => approved.has(workflow.id)).map((workflow) =>
    planWorkflow(workflow, apiModel, testModel),
  );
  const limitations = plans.flatMap((plan) => (plan.limitation ? [plan.limitation] : []));
  const supported = plans.filter((plan) => !plan.limitation);
  return {
    plans,
    renderedScenarioIds: new Set(supported.flatMap((plan) => plan.steps.map((step) => step.scenario.id))),
    limitations,
    approvedWorkflowCount: supported.length,
    unsupportedWorkflowCount: limitations.length,
    omittedWorkflowCount: Math.max(0, workflows.length - approved.size),
  };
}
