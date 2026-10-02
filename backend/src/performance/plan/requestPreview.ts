import type {
  ApiOperation,
  BodyPathSegment,
  CaptureSource,
  PerformancePlan,
  PerformanceStep,
  PreviewAuth,
  PreviewParameter,
  PreviewReference,
  PreviewValue,
  SchemaConstraint,
  StepRequestPreview,
  TestScenario,
} from "@apipilot/shared-domain";
import { MAX_TRAVERSAL_DEPTH, primaryRequestBodySchema } from "../../testDesign/requestHelpers";
import { baseBodyText, bodyEditFor, bodyKindOf } from "./bodyEdits";
import { bodySchemaMismatches, isOnlyReference } from "./bodySchemaMismatches";
import { parameterEditModel } from "./parameterEdits";
import { BASE_URL_VARIABLE } from "../../postman/artifactVariables";
import { parseCapturePath } from "./capturePath";
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
  const { journey, step, operation, scenario, generated, consumed, built } = stepRequestFor(plan, context, auth, stepId);
  const template = built.template;
  const tokenSource = built.schemeName ? auth.tokenSources.get(built.schemeName) : undefined;
  const acquiresToken = tokenSource !== undefined && (built.authKind === "chained-login" || built.authKind === "oauth2-client-credentials");
  const workflowNames = new Map(consumed.map((entry) => [entry.key, entry.name]));
  const secretByName = new Map(plan.userSuppliedValues.map((value) => [value.name, value.secret]));
  // AP-035 FR-012: a bound target shows the capture's name and step, never a value.
  const captureByKey = new Map(
    journey.source.kind === "user"
      ? consumed.map((entry) => {
          const binding = (step.bindings ?? []).find((candidate) => candidate.captureName === entry.name && targetField(candidate.target) === entry.field);
          return [entry.key, { binding, entry }] as const;
        })
      : [],
  );

  const classify = (name: string): PreviewReference => {
    if (name.startsWith(UNIQUE_TOKEN_PREFIX)) {
      const field = plan.uniqueValueFields[Number(name.slice(UNIQUE_TOKEN_PREFIX.length))];
      if (field) return { kind: "unique-per-iteration", name, format: field.format };
    }
    if (acquiresToken && name === tokenSource.tokenVariable) return { kind: "credential", name, schemeName: tokenSource.schemeName };
    const captured = captureByKey.get(name);
    if (captured?.binding) {
      const producer = journey.steps.find((candidate) => candidate.id === captured.binding!.captureStepId);
      const capture = producer?.captures?.find((candidate) => candidate.name === captured.binding!.captureName);
      const source: CaptureSource = capture?.source ?? { kind: "body", path: "", segments: [] };
      return {
        kind: "capture",
        name,
        captureName: captured.binding.captureName,
        producerStepId: captured.binding.captureStepId,
        source,
        secret: captureIsSecret(captured.binding.target, operation),
      };
    }
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
        : { contentType: template.bodyKind === "json" ? "json" : "text", text: template.body, references: [...new Set(templateReferences(template.body))].map(classify) },
    ...bodyEditModel(plan, step, operation, scenario, template, classify),
    // AP-033 FR-020 (amended 2026-09-30): the documented parameters, as generated and as edited.
    parameterEdit: parameterEditModel(plan, step, operation, generated),
  };
}

function targetField(target: NonNullable<PerformanceStep["bindings"]>[number]["target"]): string {
  return target.kind === "body" ? target.fieldPath : target.name;
}

function schemaAt(schema: SchemaConstraint | undefined, segments: readonly BodyPathSegment[]): SchemaConstraint | undefined {
  let current = schema;
  for (const segment of segments) {
    if (!current) return undefined;
    current = "index" in segment ? current.items : current.properties[segment.field];
  }
  return current;
}

/**
 * AP-035 spec Edge Cases ("Captured secrets"): a capture bound to a header, or to a field the
 * request schema declares `format: password`, is marked secret, as environment secrets are.
 */
function captureIsSecret(target: NonNullable<PerformanceStep["bindings"]>[number]["target"], operation: ApiOperation): boolean {
  if (target.kind === "header") return true;
  if (target.kind !== "body") return false;
  const parsed = parseCapturePath(target.fieldPath);
  return parsed.ok && schemaAt(primaryRequestBodySchema(operation), parsed.segments)?.format === "password";
}

type Replacement = { fieldPath: string; reference: PreviewReference };

function childPath(fieldPath: string, name: string): string {
  return fieldPath === "" ? name : `${fieldPath}.${name}`;
}

/** Every field whose sent value is one reference that the base body does not have (FR-009). */
function collectReplacements(sent: unknown, base: unknown, fieldPath: string, depth: number, classify: (name: string) => PreviewReference, out: Replacement[]): void {
  if (depth >= MAX_TRAVERSAL_DEPTH) return;
  if (isOnlyReference(sent)) {
    if (sent !== base) out.push({ fieldPath, reference: classify(templateReferences(sent)[0]) });
    return;
  }
  if (Array.isArray(sent)) {
    const items: unknown[] = Array.isArray(base) ? base : [];
    sent.forEach((item, index) => collectReplacements(item, items[index], `${fieldPath}[${index}]`, depth + 1, classify, out));
    return;
  }
  if (sent === null || typeof sent !== "object") return;
  const record = base !== null && typeof base === "object" && !Array.isArray(base) ? (base as Record<string, unknown>) : {};
  for (const [name, value] of Object.entries(sent as Record<string, unknown>)) {
    collectReplacements(value, record[name], childPath(fieldPath, name), depth + 1, classify, out);
  }
}

/**
 * AP-033 FR-009: the JSON body fields ApiPilot fills at run time. The body as sent is ApiPilot's own
 * serialization, so it always parses; the engineer's references are equal in both and not listed.
 */
function bodyReplacements(sentText: string | undefined, base: unknown, classify: (name: string) => PreviewReference): Replacement[] {
  if (sentText === undefined) return [];
  const out: Replacement[] = [];
  collectReplacements(JSON.parse(sentText), base, "", 0, classify, out);
  return out;
}

/**
 * AP-033 FR-001 (specs/033 research R12): what body the step sends, and the editor's model. The
 * editor edits the base body, before ApiPilot's substitutions (R1), so its text is the scenario's
 * body as sent (edit applied), never the preview's as-sent text with ApiPilot's tokens.
 */
function bodyEditModel(
  plan: PerformancePlan,
  step: PerformanceStep,
  operation: ApiOperation,
  scenario: TestScenario,
  template: { body?: string; bodyKind?: "json" | "text" | "form" },
  classify: (name: string) => PreviewReference,
): Pick<StepRequestPreview, "bodyStatus" | "bodyEdit"> {
  const kind = bodyKindOf(operation);
  if (kind === "none") return { bodyStatus: "not-documented", bodyEdit: null };
  if (kind === "unsupported") return { bodyStatus: "unsupported-content-type", bodyEdit: null };
  const edit = bodyEditFor(plan, step);
  const schema = primaryRequestBodySchema(operation);
  // FR-005: warnings for a JSON edit only; a generated body conforms by construction.
  const mismatches = edit?.kind === "json" && schema ? bodySchemaMismatches(schema, edit.json) : [];
  const replacements = kind === "json" && template.bodyKind === "json" ? bodyReplacements(template.body, scenario.request.body, classify) : [];
  return {
    bodyStatus: template.body === undefined ? "documented-not-sent" : "sent",
    bodyEdit: { kind, text: baseBodyText(kind, scenario.request.body), edited: edit !== undefined, mismatches, replacements },
  };
}
