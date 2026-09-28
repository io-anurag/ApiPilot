import type {
  PerformancePlan,
  PreviewAuth,
  PreviewParameter,
  PreviewReference,
  PreviewValue,
  StepRequestPreview,
} from "@apipilot/shared-domain";
import { BASE_URL_VARIABLE } from "../../postman/artifactVariables";
import { workflowVariableName } from "../../postman/workflowRendering";
import { stepRequestFor } from "./planStepRequest";
import { planAuth, templateReferences, UNIQUE_TOKEN_PREFIX, type PerformanceContext } from "./stepRequest";

/**
 * The view-only request of one plan step (AP-032 FR-008, specs/032-quick-performance-test research
 * Q8). Built from `stepRequestFor`, the same request the script sends, and derived on request: it
 * is never stored in the plan, so run snapshots stay free of bodies (AP-029 D20).
 *
 * Every `{{name}}` is shown by where its value comes from at run time: the target environment
 * (by name only, marked secret where it is a credential), a variable produced by an earlier step
 * of a guided workflow journey, a value unique per virtual user and iteration, or a token the plan
 * acquires. No environment is read, so no value can appear.
 */
const PATH_PARAMETER_SEGMENT = /^\{(.+)\}$/;
const ONLY_REFERENCE = /^\{\{([^{}]+)\}\}$/;

export function previewValueOf(text: string, classify: (name: string) => PreviewReference): PreviewValue {
  const only = ONLY_REFERENCE.exec(text);
  if (only) return classify(only[1]);
  const names = [...new Set(templateReferences(text))];
  if (names.length === 0) return { kind: "generated", text };
  return { kind: "template", text, references: names.map(classify) };
}

function splitUrl(url: string): { path: string; query: string } {
  const withoutHost = url.startsWith(`{{${BASE_URL_VARIABLE}}}`) ? url.slice(BASE_URL_VARIABLE.length + 4) : url;
  const queryStart = withoutHost.indexOf("?");
  return queryStart < 0 ? { path: withoutHost, query: "" } : { path: withoutHost.slice(0, queryStart), query: withoutHost.slice(queryStart + 1) };
}

export function buildStepRequestPreview(plan: PerformancePlan, context: PerformanceContext, stepId: string): StepRequestPreview {
  const auth = planAuth(context);
  const { step, operation, workflow, consumes, built } = stepRequestFor(plan, context, auth, stepId);
  const template = built.template;
  const tokenSource = built.schemeName ? auth.tokenSources.get(built.schemeName) : undefined;
  const acquiresToken = tokenSource !== undefined && (built.authKind === "chained-login" || built.authKind === "oauth2-client-credentials");
  const workflowNames = new Map(consumes.map((variable) => [workflowVariableName(workflow?.id ?? "", variable.name), variable.name]));
  const secretByName = new Map(plan.userSuppliedValues.map((value) => [value.name, value.secret]));

  const classify = (name: string): PreviewReference => {
    if (name.startsWith(UNIQUE_TOKEN_PREFIX)) {
      const field = plan.uniqueValueFields[Number(name.slice(UNIQUE_TOKEN_PREFIX.length))];
      if (field) return { kind: "unique-per-iteration", name, format: field.format };
    }
    if (acquiresToken && name === tokenSource.tokenVariable) return { kind: "credential", name, schemeName: tokenSource.schemeName };
    const variable = workflowNames.get(name);
    if (variable !== undefined) {
      const binding = step.variableBindings.find((candidate) => candidate.role === "consumes" && candidate.variable === variable);
      return { kind: "workflow-variable", name, variable, producerStepId: binding?.producerStepId ?? null };
    }
    return { kind: "environment", name, secret: built.secretNames.has(name) || secretByName.get(name) === true };
  };

  const { path, query } = splitUrl(template.url);
  const operationSegments = operation.path.split("/").filter((segment) => segment.length > 0);
  const templateSegments = path.split("/").filter((segment) => segment.length > 0);
  const parameters: PreviewParameter[] = [];
  operationSegments.forEach((segment, index) => {
    const name = PATH_PARAMETER_SEGMENT.exec(segment)?.[1];
    if (name !== undefined) parameters.push({ location: "path", name, value: previewValueOf(templateSegments[index] ?? "", classify) });
  });
  for (const entry of query.length > 0 ? query.split("&") : []) {
    const separator = entry.indexOf("=");
    const name = separator < 0 ? entry : entry.slice(0, separator);
    parameters.push({ location: "query", name, value: previewValueOf(separator < 0 ? "" : entry.slice(separator + 1), classify) });
  }
  for (const header of template.headers) parameters.push({ location: "header", name: header.key, value: previewValueOf(header.value, classify) });

  const authTexts =
    template.auth.kind === "bearer" ? [template.auth.token]
    : template.auth.kind === "apikey" ? [template.auth.value]
    : template.auth.kind === "basic" ? [template.auth.username, template.auth.password]
    : [];
  const previewAuth: PreviewAuth = {
    kind: built.authKind,
    schemeName: built.schemeName,
    location: template.auth.kind === "none" ? null : template.auth.kind === "apikey" ? template.auth.in : "header",
    references: [...new Set(authTexts.flatMap(templateReferences))].map(classify),
  };

  return {
    stepId: step.id,
    operationKey: step.operationKey,
    method: step.method,
    pathTemplate: operation.path,
    parameters,
    auth: previewAuth,
    body:
      template.body === undefined
        ? null
        : { contentType: template.bodyKind ?? "text", text: template.body, references: [...new Set(templateReferences(template.body))].map(classify) },
  };
}
