import type {
  ApiOperation,
  BodyEdit,
  BodyEditNotice,
  PerformanceJourney,
  PerformancePlan,
  PerformanceStep,
  SchemaConstraint,
  TestScenario,
  UniqueValueField,
} from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE } from "../../postman/requestItem";
import { workflowVariableName } from "../../postman/workflowRendering";
import { MAX_TRAVERSAL_DEPTH, primaryRequestBodyContentType, primaryRequestBodySchema } from "../../testDesign/requestHelpers";
import { InvalidBodyEditError, InvalidPlanUpdateError } from "../errors";
import { isOnlyReference } from "./bodySchemaMismatches";
import { canonicalJson } from "./identifiers";
import {
  operationKeyOf,
  planAuth,
  templateReferences,
  UNIQUE_TOKEN_PREFIX,
  CAPTURE_KEY_PREFIX,
  type BuiltStepRequest,
  type PerformanceContext,
} from "./stepRequest";

/**
 * AP-033, Edit a Performance Step's Request Body (specs/033-edit-step-request-body research R1 to
 * R9). The engineer edits a step's base body: its body before ApiPilot applies workflow variables,
 * per-iteration unique values and credential references. ApiPilot then applies those to the edited
 * body exactly as it does to a generated one, so every reference keeps working and no positional
 * token name is ever stored.
 *
 * `effectiveScenario` is the one place an edit is applied. Plan assembly (`buildJourneys`) and
 * `stepRequestFor` (the script and the preview) both call it, so the preview stays the request the
 * script sends (R3).
 *
 * Nothing here logs, and no error message quotes the engineer's text (R14).
 */

/** R6 check 3: 64 KiB in UTF-8, well under the app's JSON body limit. */
export const MAX_BODY_EDIT_BYTES = 65_536;

/** The scenario with its body replaced by the edit, or the scenario itself when there is none. */
export function effectiveScenario(scenario: TestScenario, edit: BodyEdit | undefined): TestScenario {
  if (!edit) return scenario;
  const body = edit.kind === "json" ? edit.json : edit.text;
  return { ...scenario, request: { ...scenario.request, body } };
}

/**
 * How an operation's body can be edited (R6 check 2), by the same content-type rules the request
 * builder serializes with (`buildBody`): JSON-like, or none declared, is JSON; `text/*` is text;
 * anything else (form, multipart) cannot be edited; no documented body is `none`.
 */
export type BodyKind = "json" | "text" | "unsupported" | "none";

export function bodyKindOf(operation: ApiOperation): BodyKind {
  if (!operation.requestBody) return "none";
  const contentType = primaryRequestBodyContentType(operation);
  if (contentType === undefined || JSON_CONTENT_TYPE.test(contentType)) return "json";
  if (TEXT_CONTENT_TYPE.test(contentType)) return "text";
  return "unsupported";
}

/** A base body as the editor shows it: formatted JSON, the text itself, or `""` when none is sent. */
export function baseBodyText(kind: "json" | "text", body: unknown): string {
  if (body === undefined) return "";
  if (kind === "json") return JSON.stringify(body, null, 2);
  return typeof body === "string" ? body : "";
}

/** The edit a plan step sends, if any: one made for this step and the scenario it uses (R9). */
export function bodyEditFor(plan: PerformancePlan, step: PerformanceStep): BodyEdit | undefined {
  return plan.bodyEdits.find((edit) => edit.stepId === step.id && edit.scenarioId === step.scenarioId);
}

// --- Locating a JSON syntax error (R6 check 4) ------------------------------------------------

type Expect = "value" | "value-or-close" | "key" | "key-or-close" | "colon" | "comma-or-close" | "end";

interface Scan {
  readonly text: string;
  i: number;
  expect: Expect;
  readonly stack: ("array" | "object")[];
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERALS = ["true", "false", "null"] as const;
const SIMPLE_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);
const HEX4 = /^[0-9a-fA-F]{4}$/;

function afterValue(scan: Scan): void {
  scan.expect = scan.stack.length === 0 ? "end" : "comma-or-close";
}

/** The index after a string starting at `start`, or `-(errorIndex + 1)`. */
function stringEnd(text: string, start: number): number {
  let j = start + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '"') return j + 1;
    if (ch === "\\") {
      const next = text[j + 1];
      if (next !== undefined && SIMPLE_ESCAPES.has(next)) j += 2;
      else if (next === "u" && HEX4.test(text.slice(j + 2, j + 6))) j += 6;
      else return -(j + 1);
    } else if ((ch.codePointAt(0) ?? 0) < 0x20) {
      return -(j + 1);
    } else {
      j += 1;
    }
  }
  return -(text.length + 1);
}

/** The index after a number or literal starting at `start`, or `-(start + 1)`. */
function primitiveEnd(text: string, start: number): number {
  NUMBER.lastIndex = start;
  const number = NUMBER.exec(text);
  if (number) return start + number[0].length;
  const literal = LITERALS.find((candidate) => text.startsWith(candidate, start));
  return literal ? start + literal.length : -(start + 1);
}

/** Advances past one value's start; `false` leaves `scan.i` at the error. */
function scanValue(scan: Scan, ch: string): boolean {
  if (ch === "{" || ch === "[") {
    scan.stack.push(ch === "{" ? "object" : "array");
    scan.i += 1;
    scan.expect = ch === "{" ? "key-or-close" : "value-or-close";
    return true;
  }
  const end = ch === '"' ? stringEnd(scan.text, scan.i) : primitiveEnd(scan.text, scan.i);
  if (end < 0) {
    scan.i = -end - 1;
    return false;
  }
  scan.i = end;
  afterValue(scan);
  return true;
}

function scanClose(scan: Scan, ch: string): boolean {
  const top = scan.stack.at(-1);
  if ((top === "array" && ch === "]") || (top === "object" && ch === "}")) {
    scan.stack.pop();
    scan.i += 1;
    afterValue(scan);
    return true;
  }
  return false;
}

function scanKey(scan: Scan, ch: string): boolean {
  if (ch !== '"') return false;
  const end = stringEnd(scan.text, scan.i);
  if (end < 0) {
    scan.i = -end - 1;
    return false;
  }
  scan.i = end;
  scan.expect = "colon";
  return true;
}

function scanStep(scan: Scan, ch: string): boolean {
  switch (scan.expect) {
    case "value-or-close":
      return scanClose(scan, ch) || scanValue(scan, ch);
    case "value":
      return scanValue(scan, ch);
    case "key-or-close":
      return scanClose(scan, ch) || scanKey(scan, ch);
    case "key":
      return scanKey(scan, ch);
    case "colon":
      if (ch !== ":") return false;
      scan.i += 1;
      scan.expect = "value";
      return true;
    case "comma-or-close":
      if (ch === ",") {
        scan.i += 1;
        scan.expect = scan.stack.at(-1) === "object" ? "key" : "value";
        return true;
      }
      return scanClose(scan, ch);
    case "end":
      return false;
  }
}

/**
 * The offset of the first character that cannot continue a valid JSON text, the text's length for
 * an unfinished one, or `null` when it is valid. One pass, no recursion, so a body of nested
 * brackets cannot exhaust the stack. Used only after `JSON.parse` has failed, because V8's messages
 * do not always carry a position and quote the input.
 */
export function jsonErrorOffset(text: string): number | null {
  const scan: Scan = { text, i: 0, expect: "value", stack: [] };
  for (;;) {
    while (scan.i < text.length && WHITESPACE.has(text[scan.i])) scan.i += 1;
    if (scan.i >= text.length) return scan.expect === "end" ? null : text.length;
    if (!scanStep(scan, text[scan.i])) return scan.i;
  }
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** Container nesting of a parsed value, measured without recursion; stops once over `limit`. */
function exceedsDepth(value: unknown, limit: number): boolean {
  const pending: [unknown, number][] = [[value, 1]];
  while (pending.length > 0) {
    const [current, depth] = pending.pop()!;
    if (current === null || typeof current !== "object") continue;
    if (depth > limit) return true;
    for (const child of Object.values(current as Record<string, unknown>)) pending.push([child, depth + 1]);
  }
  return false;
}

function parseJsonEdit(stepId: string, text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const offset = jsonErrorOffset(text);
    if (offset !== null) {
      const { line, column } = lineAndColumn(text, offset);
      throw new InvalidBodyEditError("invalid_body", stepId, `Not valid JSON at line ${line}, column ${column}.`, { line, column });
    }
    throw new InvalidBodyEditError("invalid_body", stepId, `The body is nested deeper than ${MAX_TRAVERSAL_DEPTH} levels.`);
  }
  if (exceedsDepth(parsed, MAX_TRAVERSAL_DEPTH)) {
    throw new InvalidBodyEditError("invalid_body", stepId, `The body is nested deeper than ${MAX_TRAVERSAL_DEPTH} levels.`);
  }
  return parsed;
}

// --- References and sensitive fields (R4, R8) ---------------------------------------------------

function childPath(fieldPath: string, name: string): string {
  return fieldPath === "" ? name : `${fieldPath}.${name}`;
}

/**
 * Every `format: password` field present in `value`, with its value, walked by the schema to
 * `MAX_TRAVERSAL_DEPTH` (R8). Sensitive fields come from the schema only, never from field names.
 */
function passwordFields(schema: SchemaConstraint | undefined, value: unknown, fieldPath = "", depth = 0): { fieldPath: string; value: unknown }[] {
  if (!schema || value === undefined || depth >= MAX_TRAVERSAL_DEPTH) return [];
  if (schema.format === "password") return [{ fieldPath, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => passwordFields(schema.items, item, `${fieldPath}[${index}]`, depth + 1));
  }
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Object.entries(schema.properties).flatMap(([name, child]) => passwordFields(child, record[name], childPath(fieldPath, name), depth + 1));
}

/** R4: names ApiPilot uses for its own substitutions, which an engineer's `{{name}}` must not take. */
export function reservedNamesOf(context: PerformanceContext): (name: string) => boolean {
  const names = new Set<string>();
  for (const workflow of context.workflows) {
    for (const variable of workflow.variables) names.add(workflowVariableName(workflow.id, variable.name));
  }
  for (const source of planAuth(context).tokenSources.values()) names.add(source.tokenVariable);
  // AP-035 research R5: a capture's script key, so an engineer's `{{name}}` cannot reach a captured value.
  return (name) => name.startsWith(UNIQUE_TOKEN_PREFIX) || name.startsWith(CAPTURE_KEY_PREFIX) || names.has(name);
}

/**
 * R4, T039a: the environment values an edited body refers to by a `{{name}}` the engineer wrote,
 * and those that fill a `format: password` field, which are secret.
 */
export function engineerReferences(operation: ApiOperation, body: unknown): { names: string[]; secretNames: string[] } {
  const text = typeof body === "string" ? body : (JSON.stringify(body) ?? "");
  const names = [...new Set(templateReferences(text))].sort(compareCodeUnits);
  const secretNames = passwordFields(primaryRequestBodySchema(operation), body)
    .flatMap(({ value }) => (isOnlyReference(value) ? templateReferences(value) : []))
    .sort(compareCodeUnits);
  return { names, secretNames: [...new Set(secretNames)] };
}

/**
 * FR-010 (R4): for each edited step, the workflow variables whose field the edit removed, and the
 * unique fields its generated body had that the edit no longer carries. In code-unit order of step,
 * then name.
 */
export function bodyEditNoticesOf(
  journeys: readonly PerformanceJourney[],
  requests: ReadonlyMap<string, BuiltStepRequest>,
  uniqueValueFields: readonly UniqueValueField[],
  generatedUniqueFields: ReadonlyMap<string, readonly string[]>,
): BodyEditNotice[] {
  const notices: BodyEditNotice[] = [];
  for (const step of journeys.flatMap((journey) => journey.steps).filter((candidate) => candidate.bodyEdited)) {
    for (const name of requests.get(step.id)?.droppedBodyConsumers ?? []) {
      notices.push({ stepId: step.id, kind: "workflow-variable-dropped", name });
    }
    const kept = new Set(uniqueValueFields.filter((field) => field.stepId === step.id).map((field) => field.fieldPath));
    for (const fieldPath of generatedUniqueFields.get(step.id) ?? []) {
      if (!kept.has(fieldPath)) notices.push({ stepId: step.id, kind: "unique-field-dropped", name: fieldPath });
    }
  }
  return notices.sort((a, b) => compareCodeUnits(a.stepId, b.stepId) || compareCodeUnits(a.name, b.name));
}

// --- Checks on save (R6) ----------------------------------------------------------------------

interface BodyEditEntry {
  kind: "json" | "text";
  text: string;
}

/** R6 shape check: `null` (reset) or `{kind, text}`; anything else is `invalid_request`. */
function parseEntry(raw: unknown): BodyEditEntry | null {
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidPlanUpdateError("Each body edit must be {kind, text} or null.");
  }
  const { kind, text } = raw as Record<string, unknown>;
  if ((kind !== "json" && kind !== "text") || typeof text !== "string") {
    throw new InvalidPlanUpdateError("Each body edit must be {kind, text} or null, with kind json or text.");
  }
  return { kind, text };
}

function notAcceptedReason(kind: BodyKind): string {
  if (kind === "none") return "This operation documents no request body.";
  if (kind === "unsupported") return "Form and multipart bodies cannot be edited.";
  return kind === "json" ? "This operation's body is JSON." : "This operation's body is text.";
}

/** R6 check 5: no `{{name}}` may use a name ApiPilot reserves. */
function checkReferences(stepId: string, text: string, isReserved: (name: string) => boolean): void {
  const reserved = templateReferences(text).find(isReserved);
  if (reserved !== undefined) {
    throw new InvalidBodyEditError("reserved_reference", stepId, `{{${reserved}}} is a name ApiPilot uses for its own values. Use another name.`, {
      reference: reserved,
    });
  }
}

/** R6 check 6 (FR-012a): a `format: password` field holds exactly one `{{name}}` reference. */
function checkPasswordFields(stepId: string, operation: ApiOperation, json: unknown): void {
  const literal = passwordFields(primaryRequestBodySchema(operation), json).find(({ value }) => !isOnlyReference(value));
  if (literal) {
    const field = literal.fieldPath === "" ? "The body" : `\`${literal.fieldPath}\``;
    throw new InvalidBodyEditError(
      "body_secret_literal",
      stepId,
      `${field} is a password field. Reference an environment value as {{name}} instead of typing a value.`,
      { fieldPath: literal.fieldPath },
    );
  }
}

/** R6 checks 2 to 6 for one step; `undefined` means the edit equals the generated body. */
function checkedEdit(
  step: PerformanceStep,
  operation: ApiOperation,
  generated: TestScenario,
  entry: BodyEditEntry,
  isReserved: (name: string) => boolean,
): BodyEdit | undefined {
  const kind = bodyKindOf(operation);
  if (kind !== entry.kind) throw new InvalidBodyEditError("body_not_accepted", step.id, notAcceptedReason(kind));
  if (Buffer.byteLength(entry.text, "utf8") > MAX_BODY_EDIT_BYTES) {
    throw new InvalidBodyEditError("body_too_large", step.id, "The body is larger than 64 KiB.", { limitBytes: MAX_BODY_EDIT_BYTES });
  }
  const identity = { stepId: step.id, operationKey: step.operationKey, scenarioId: step.scenarioId };
  if (entry.kind === "text") {
    checkReferences(step.id, entry.text, isReserved);
    return entry.text === baseBodyText("text", generated.request.body) ? undefined : { ...identity, kind: "text", text: entry.text };
  }
  const json = parseJsonEdit(step.id, entry.text);
  checkReferences(step.id, entry.text, isReserved);
  const unchanged = generated.request.body !== undefined && canonicalJson(json) === canonicalJson(generated.request.body);
  if (unchanged) return undefined;
  checkPasswordFields(step.id, operation, json);
  return { ...identity, kind: "json", json };
}

/**
 * `PUT /plan`'s `bodyEdits` (contracts/body-edits-api.md, research R6): the plan's next edits, or
 * the first refusal. Entries are checked in code-unit order of step id, so the same request always
 * fails the same way. Nothing is applied unless every entry passes.
 */
export function validateBodyEdits(plan: PerformancePlan, context: PerformanceContext, raw: unknown): BodyEdit[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidPlanUpdateError("bodyEdits must map step ids to a body edit or null.");
  }
  const entries = Object.entries(raw as Record<string, unknown>)
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([stepId, value]) => [stepId, parseEntry(value)] as const);
  const steps = plan.journeys.flatMap((journey) => journey.steps);
  const next = new Map(plan.bodyEdits.map((edit) => [edit.stepId, edit]));
  const isReserved = reservedNamesOf(context);

  for (const [stepId, entry] of entries) {
    const step = steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new InvalidBodyEditError("invalid_body_edit", stepId, "This step is not in the plan. Restore its operation to edit its body.");
    }
    if (entry === null) {
      next.delete(stepId);
      continue;
    }
    const operation = context.apiModel.operations.find((candidate) => operationKeyOf(candidate) === step.operationKey);
    const generated = context.approvedScenarios.find((candidate) => candidate.id === step.scenarioId);
    if (!operation || !generated) throw new Error(`The plan's step ${step.id} no longer matches the approvals.`);
    const edit = checkedEdit(step, operation, generated, entry, isReserved);
    if (edit) next.set(stepId, edit);
    else next.delete(stepId);
  }
  return [...next.values()].sort((a, b) => compareCodeUnits(a.stepId, b.stepId));
}
