import type {
  ApiOperation,
  EditableParameterLocation,
  Parameter,
  ParameterEdit,
  ParameterEditEntry,
  ParameterNotEditableReason,
  PerformancePlan,
  PerformanceStep,
  StepParameterEditModel,
  StepParameterEditRow,
  TestScenario,
} from "@apipilot/shared-domain";
import { pathParameterVariableName } from "../../postman/artifactVariables";
import { compareCodeUnits } from "../../postman/ordering";
import { InvalidParameterEditError, InvalidPlanUpdateError } from "../errors";
import { reservedNamesOf } from "./bodyEdits";
import { isOnlyReference } from "./bodySchemaMismatches";
import { operationKeyOf, templateReferences, type PerformanceContext } from "./stepRequest";

/**
 * AP-033 FR-020 to FR-022 (amended 2026-09-30): the engineer edits the path, query and header
 * parameters a step sends: a new value for any documented parameter, or an optional one left out.
 * An edit changes the scenario's request before ApiPilot applies workflow variables and
 * credentials, exactly as a body edit does, so `effectiveScenario` callers apply both and the
 * preview stays the request the script sends.
 *
 * A parameter a workflow variable fills is not editable (its value comes from an earlier step), nor
 * is one whose schema is an array or object (its serialization style is the specification's).
 * Nothing here logs, and no refusal quotes a value.
 */

/** Longest accepted value, in UTF-8. A parameter is a short value; a body edit has its own limit. */
export const MAX_PARAMETER_VALUE_BYTES = 2_048;

const LOCATION_ORDER: Record<EditableParameterLocation, number> = { path: 0, query: 1, header: 2 };
const REQUEST_FIELD = { path: "pathParameters", query: "queryParameters", header: "headers" } as const;

/** A control character would split a header or corrupt a URL; nothing in a parameter needs one. */
function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function byLocationThenName(a: { location: EditableParameterLocation; name: string }, b: { location: EditableParameterLocation; name: string }): number {
  return LOCATION_ORDER[a.location] - LOCATION_ORDER[b.location] || compareCodeUnits(a.name, b.name);
}

function isEditableLocation(location: Parameter["location"]): location is EditableParameterLocation {
  return location === "path" || location === "query" || location === "header";
}

/** The operation's documented path, query and header parameters, by location then name. */
export function editableParametersOf(operation: ApiOperation): (Parameter & { location: EditableParameterLocation })[] {
  return operation.parameters
    .filter((parameter): parameter is Parameter & { location: EditableParameterLocation } => isEditableLocation(parameter.location))
    .sort(byLocationThenName);
}

/** The edit a plan step sends, if any: one made for this step and the scenario it uses. */
export function parameterEditFor(plan: PerformancePlan, step: PerformanceStep): ParameterEdit | undefined {
  // A plan held from before the amendment has no `parameterEdits`.
  return (plan.parameterEdits ?? []).find((edit) => edit.stepId === step.id && edit.scenarioId === step.scenarioId);
}

/** The scenario with the edit's parameters set or left out, or the scenario itself when there is none. */
export function applyParameterEdit(scenario: TestScenario, edit: ParameterEdit | undefined): TestScenario {
  if (!edit) return scenario;
  const request = {
    ...scenario.request,
    pathParameters: { ...scenario.request.pathParameters },
    queryParameters: { ...scenario.request.queryParameters },
    headers: { ...scenario.request.headers },
  };
  for (const entry of edit.parameters) {
    const values: Record<string, unknown> = request[REQUEST_FIELD[entry.location]];
    // Header names are case-insensitive, so an edit replaces the generated header however it is cased.
    const keys = entry.location === "header" ? Object.keys(values).filter((key) => key.toLowerCase() === entry.name.toLowerCase()) : [entry.name];
    for (const key of keys) delete values[key];
    if (entry.action === "set") values[entry.name] = entry.value;
  }
  return { ...scenario, request };
}

/** Path parameters the edit sets, which keep their value instead of becoming environment values. */
export function editedPathParameters(edit: ParameterEdit | undefined): Set<string> {
  return new Set((edit?.parameters ?? []).filter((entry) => entry.location === "path" && entry.action === "set").map((entry) => entry.name));
}

/** The environment values an edit refers to by `{{name}}`, and those in a `format: password` parameter, which are secret. */
export function parameterEditReferences(operation: ApiOperation, edit: ParameterEdit): { names: string[]; secretNames: string[] } {
  const documented = editableParametersOf(operation);
  const names = new Set<string>();
  const secretNames = new Set<string>();
  for (const entry of edit.parameters) {
    if (entry.action !== "set") continue;
    const references = templateReferences(entry.value);
    for (const name of references) names.add(name);
    const parameter = documented.find((candidate) => candidate.location === entry.location && candidate.name === entry.name);
    if (parameter?.schema.format === "password") for (const name of references) secretNames.add(name);
  }
  return { names: [...names].sort(compareCodeUnits), secretNames: [...secretNames].sort(compareCodeUnits) };
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The value the generated scenario sends for a parameter, as text; path parameters come from the environment unless a reference. */
function generatedText(operation: ApiOperation, scenario: TestScenario, location: EditableParameterLocation, name: string): string | null {
  const values: Record<string, unknown> = scenario.request[REQUEST_FIELD[location]];
  const key = location === "header" ? Object.keys(values).find((candidate) => candidate.toLowerCase() === name.toLowerCase()) : name;
  const value = key === undefined ? undefined : values[key];
  if (location === "path") return isOnlyReference(value) ? value : `{{${pathParameterVariableName(operation.path, name)}}}`;
  return value === undefined ? null : valueText(value);
}

function notEditableReason(step: PerformanceStep, parameter: Parameter & { location: EditableParameterLocation }): ParameterNotEditableReason | null {
  const filled = step.variableBindings.some(
    (binding) => binding.role === "consumes" && binding.location === parameter.location && binding.field === parameter.name,
  );
  if (filled) return "filled-at-run-time";
  if (parameter.schema.type === "array" || parameter.schema.type === "object") return "structured-value";
  return null;
}

function rowEdit(entry: ParameterEditEntry): StepParameterEditRow["edit"] {
  return entry.action === "set" ? { action: "set", value: entry.value } : { action: "omit" };
}

/** AP-033 FR-020: the parameter editor's rows for one step, or `null` when nothing is documented. */
export function parameterEditModel(plan: PerformancePlan, step: PerformanceStep, operation: ApiOperation, generated: TestScenario): StepParameterEditModel | null {
  const parameters = editableParametersOf(operation);
  if (parameters.length === 0) return null;
  const edit = parameterEditFor(plan, step);
  const rows = parameters.map((parameter): StepParameterEditRow => {
    const entry = edit?.parameters.find((candidate) => candidate.location === parameter.location && candidate.name === parameter.name);
    return {
      location: parameter.location,
      name: parameter.name,
      required: parameter.required || parameter.location === "path",
      type: parameter.schema.type ?? null,
      format: parameter.schema.format ?? null,
      enum: parameter.schema.enum ? parameter.schema.enum.map(valueText) : null,
      generated: generatedText(operation, generated, parameter.location, parameter.name),
      edit: entry ? rowEdit(entry) : null,
      notEditable: notEditableReason(step, parameter),
      secret: parameter.schema.format === "password",
    };
  });
  return { rows, edited: edit !== undefined };
}

// --- Checks on save --------------------------------------------------------------------------

function parseEntries(stepId: string, raw: unknown): ParameterEditEntry[] | null {
  if (raw === null) return null;
  const list = typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).parameters : undefined;
  if (!Array.isArray(list)) throw new InvalidPlanUpdateError("Each parameter edit must be {parameters: [...]} or null.");
  return list.map((item): ParameterEditEntry => {
    const { location, name, action, value } = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    if (location !== "path" && location !== "query" && location !== "header") {
      throw new InvalidPlanUpdateError("A parameter's location must be path, query or header.");
    }
    if (typeof name !== "string") throw new InvalidPlanUpdateError("A parameter needs a name.");
    if (action === "omit") return { location, name, action };
    if (action !== "set" || typeof value !== "string") {
      throw new InvalidParameterEditError("invalid_parameter_edit", stepId, "Each parameter is either set to a text value or omitted.", { location, name });
    }
    return { location, name, action, value };
  });
}

function checkEntry(
  step: PerformanceStep,
  operation: ApiOperation,
  entry: ParameterEditEntry,
  isReserved: (name: string) => boolean,
): void {
  const where = { location: entry.location, name: entry.name };
  const parameter = editableParametersOf(operation).find((candidate) => candidate.location === entry.location && candidate.name === entry.name);
  if (!parameter) {
    throw new InvalidParameterEditError("invalid_parameter_edit", step.id, `${entry.location} parameter "${entry.name}" is not documented for this operation.`, where);
  }
  const reason = notEditableReason(step, parameter);
  if (reason === "filled-at-run-time") {
    throw new InvalidParameterEditError("parameter_not_editable", step.id, `"${entry.name}" is filled at run time by a value from an earlier step.`, where);
  }
  if (reason === "structured-value" && entry.action === "set") {
    throw new InvalidParameterEditError("parameter_not_editable", step.id, `"${entry.name}" is an array or object; it can be left out but not edited.`, where);
  }
  if (entry.action === "omit") {
    if (parameter.required || parameter.location === "path") {
      throw new InvalidParameterEditError("parameter_required", step.id, `"${entry.name}" is required, so it cannot be left out.`, where);
    }
    return;
  }
  if (parameter.location === "path" && entry.value.trim() === "") {
    throw new InvalidParameterEditError("parameter_required", step.id, `Path parameter "${entry.name}" needs a value.`, where);
  }
  if (Buffer.byteLength(entry.value, "utf8") > MAX_PARAMETER_VALUE_BYTES) {
    throw new InvalidParameterEditError("parameter_too_long", step.id, `"${entry.name}" is longer than 2 KiB.`, { ...where, limitBytes: MAX_PARAMETER_VALUE_BYTES });
  }
  if (hasControlCharacter(entry.value)) {
    throw new InvalidParameterEditError("invalid_parameter_edit", step.id, `"${entry.name}" cannot contain a line break or other control character.`, where);
  }
  const reserved = templateReferences(entry.value).find(isReserved);
  if (reserved !== undefined) {
    throw new InvalidParameterEditError("reserved_reference", step.id, `{{${reserved}}} is a name ApiPilot uses for its own values. Use another name.`, {
      ...where,
      reference: reserved,
    });
  }
  // FR-021 (constitution XVII): a password parameter holds exactly one environment reference.
  if (parameter.schema.format === "password" && !isOnlyReference(entry.value)) {
    throw new InvalidParameterEditError(
      "parameter_secret_literal",
      step.id,
      `"${entry.name}" is a password parameter. Reference an environment value as {{name}} instead of typing a value.`,
      where,
    );
  }
}

/** The entries that change the request: a value other than the generated one, or leaving out a parameter the scenario sends. */
function effectiveEntries(operation: ApiOperation, generated: TestScenario, entries: ParameterEditEntry[]): ParameterEditEntry[] {
  return entries
    .filter((entry) => {
      const current = generatedText(operation, generated, entry.location, entry.name);
      return entry.action === "omit" ? current !== null : entry.value !== current;
    })
    .sort(byLocationThenName);
}

/**
 * `PUT /plan`'s `parameterEdits`: the plan's next edits, or the first refusal. Steps are checked in
 * code-unit order of step id and each step's entries by location then name, so the same request
 * always fails the same way. Nothing is applied unless every entry passes.
 */
export function validateParameterEdits(plan: PerformancePlan, context: PerformanceContext, raw: unknown): ParameterEdit[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidPlanUpdateError("parameterEdits must map step ids to a parameter edit or null.");
  }
  const steps = plan.journeys.flatMap((journey) => journey.steps);
  const next = new Map((plan.parameterEdits ?? []).map((edit) => [edit.stepId, edit]));
  const isReserved = reservedNamesOf(context);

  for (const [stepId, value] of Object.entries(raw as Record<string, unknown>).sort(([a], [b]) => compareCodeUnits(a, b))) {
    const entries = parseEntries(stepId, value);
    const step = steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new InvalidParameterEditError("invalid_parameter_edit", stepId, "This step is not in the plan. Restore its operation to edit its parameters.");
    }
    if (entries === null) {
      next.delete(stepId);
      continue;
    }
    const operation = context.apiModel.operations.find((candidate) => operationKeyOf(candidate) === step.operationKey);
    const generated = context.approvedScenarios.find((candidate) => candidate.id === step.scenarioId);
    if (!operation || !generated) throw new Error(`The plan's step ${step.id} no longer matches the approvals.`);
    const sorted = [...entries].sort(byLocationThenName);
    const duplicate = sorted.find((entry, index) => index > 0 && byLocationThenName(entry, sorted[index - 1]) === 0);
    if (duplicate) {
      throw new InvalidParameterEditError("invalid_parameter_edit", stepId, `"${duplicate.name}" is listed more than once.`, { location: duplicate.location, name: duplicate.name });
    }
    for (const entry of sorted) checkEntry(step, operation, entry, isReserved);
    const parameters = effectiveEntries(operation, generated, sorted);
    if (parameters.length === 0) next.delete(stepId);
    else next.set(stepId, { stepId, operationKey: step.operationKey, scenarioId: step.scenarioId, parameters });
  }
  return [...next.values()].sort((a, b) => compareCodeUnits(a.stepId, b.stepId));
}
