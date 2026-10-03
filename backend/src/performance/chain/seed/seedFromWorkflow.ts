import { formatCapturePath, type BodyPathSegment } from "@apipilot/shared-domain";
import { buildPlan } from "../../plan/buildPlan";
import { operationsInScope } from "../../plan/buildJourneys";
import { prefillExpectedStatuses } from "../../plan/expectedStatuses";
import { stepRequestFor } from "../../plan/planStepRequest";
import { operationKeyOf, planAuth, type PerformanceContext } from "../../plan/stepRequest";
import type { SeedInput, SeedStep } from "./assembleSeededPlan";
import { basicAuthItem, credentialStep, passwordFieldsOf } from "./seedFromSpecification";
import { referenceName, toChainRequest } from "./toChainStep";

/**
 * Seeding from the guided workflow (specs/037-request-chain-performance FR-023; research R16). The
 * guided plan's own builder gives one journey per approved workflow and one single-step journey per
 * other operation in scope, with each workflow variable captured by its producer and filled into its
 * consumers. Seeding keeps that as text: a variable becomes an extractor on its producer and a
 * `{{name}}` reference on its consumers. Only approved workflows are chained (constitution XV); no
 * extractor or reference is added beyond them. Credentials become Once before load steps, as for a
 * specification (FR-022). Nothing is sent.
 */
function pathOf(segments: readonly (string | number)[]): string {
  return formatCapturePath(segments.map((segment): BodyPathSegment => (typeof segment === "number" ? { index: segment } : { field: segment })));
}

function rename(text: string, names: ReadonlyMap<string, string>): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (match, name: string) => {
    const replacement = names.get(name);
    return replacement === undefined ? match : `{{${replacement}}}`;
  });
}

export function seedFromWorkflow(context: PerformanceContext, specificationTitle: string, name: string, now: string): Omit<SeedInput, "environment"> {
  const plan = buildPlan(context);
  const auth = planAuth(context);
  const chains: SeedInput["chains"] = [];
  const items: SeedInput["report"]["items"] = [];
  const secretNames: string[] = [];
  const credentialSteps = [...auth.tokenSources.values()].sort((a, b) => (a.schemeName < b.schemeName ? -1 : a.schemeName > b.schemeName ? 1 : 0)).map((source) => credentialStep(source, context));
  if (credentialSteps.length > 0) chains.push({ name: "Credentials", steps: credentialSteps });
  for (const entry of auth.schemePlan.values()) if (entry.type === "oauth2") secretNames.push(referenceName(entry.variableNames.clientSecret));

  const seeded = new Set(plan.journeys.flatMap((journey) => (journey.source.kind === "workflow" ? [journey.source.workflowId] : [])));
  context.workflows.forEach((workflow, index) => {
    if (!seeded.has(workflow.id)) {
      items.push({ kind: "workflow-fallback", sourceLabel: `Workflow ${index + 1}`, detail: "A step of this workflow has no approved positive scenario, so its operations were seeded as single steps." });
    }
  });

  let workflowNumber = 0;
  for (const journey of plan.journeys) {
    const isWorkflow = journey.source.kind === "workflow";
    if (isWorkflow) workflowNumber += 1;
    const workflowId = journey.source.kind === "workflow" ? journey.source.workflowId : "";
    const chainName = isWorkflow ? `Workflow ${workflowNumber} (${journey.steps.length} steps)` : journey.steps[0]?.operationKey ?? "Operation";
    const steps: SeedStep[] = [];
    for (const step of journey.steps) {
      const request = stepRequestFor(plan, context, auth, step.id);
      const names = new Map<string, string>();
      for (const consumed of request.consumed) names.set(consumed.key, referenceName(consumed.name));
      for (const unique of request.unique) names.set(unique.token, unique.format === "uuid" ? "$guid" : "$randomEmail");
      const template = {
        ...request.built.template,
        url: rename(request.built.template.url, names),
        headers: request.built.template.headers.map((header) => ({ key: header.key, value: rename(header.value, names) })),
        ...(request.built.template.body === undefined ? {} : { body: rename(request.built.template.body, names) }),
      };
      const converted = toChainRequest(template, `${request.built.schemeName ?? "basic"}_basic`);
      const key = operationKeyOf(request.operation);
      secretNames.push(...[...request.built.secretNames].map(referenceName));
      if (converted.basicValueName) {
        secretNames.push(converted.basicValueName);
        items.push(basicAuthItem(key, converted.basicValueName));
      }
      steps.push({
        name: request.operation.operationId ?? key,
        request: converted.request,
        expectedStatuses: prefillExpectedStatuses(request.operation),
        extractors: request.captures.map((capture) => ({
          name: referenceName(capture.name),
          source: "header" in capture.source ? { kind: "header" as const, name: capture.source.header } : { kind: "body" as const, path: pathOf(capture.source.body) },
        })),
        runs: "every-iteration",
        source: isWorkflow
          ? { kind: "workflow", workflowId, workflowName: chainName, operationKey: key, label: key, passwordFields: passwordFieldsOf(request.operation) }
          : { kind: "operation", operationKey: key, label: key, passwordFields: passwordFieldsOf(request.operation) },
      });
    }
    if (steps.length > 0) chains.push({ name: chainName, steps });
  }
  const inScope = new Set(operationsInScope(context).map(operationKeyOf));
  for (const omitted of plan.omitted) {
    if (inScope.has(omitted.operationKey)) items.push({ kind: "no-positive-scenario", sourceLabel: omitted.operationKey, detail: "The operation has no approved positive scenario, so no step was seeded for it." });
  }
  return { name, chains, secretNames, now, report: { source: { kind: "workflow", specificationTitle }, seededAt: now, items } };
}
