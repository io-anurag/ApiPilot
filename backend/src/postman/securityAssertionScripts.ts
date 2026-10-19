import type { EvaluationCondition, PostmanEvent } from "@apipilot/shared-domain";

/**
 * Fixed Postman test templates for the evaluation conditions a collection can express (specs/057
 * contracts/postman-security-amendment.md "Item construction"). The text is ApiPilot's own. Only a status number, a
 * header name or a field path is ever inserted, and only after it has been validated against a strict shape and written
 * as a JSON string or number literal, so no scenario text can become code. A condition with no template is reported as
 * not expressible by the caller; it is never approximated.
 */

const STATUS_CODE = /^[1-5]\d\d$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,100}$/;
const FIELD_PATH_SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_CODES = 20;

function statusNumber(code: number): number | undefined {
  return Number.isInteger(code) && STATUS_CODE.test(String(code)) ? code : undefined;
}

/** The segments of a dotted body path made only of plain names, or undefined when the path needs more than a template can say. */
function fieldSegments(path: string): string[] | undefined {
  const trimmed = path.startsWith("$.") ? path.slice(2) : path;
  const segments = trimmed.split(".");
  return segments.length > 0 && segments.length <= 10 && segments.every((segment) => FIELD_PATH_SEGMENT.test(segment)) ? segments : undefined;
}

function fieldLines(segments: string[], presence: boolean, label: string): string[] {
  return [
    `pm.test(${JSON.stringify(label)}, function () {`,
    "  var body;",
    "  try { body = pm.response.json(); } catch (error) { body = undefined; }",
    `  var path = ${JSON.stringify(segments)};`,
    "  var node = body;",
    "  var found = true;",
    "  for (var index = 0; index < path.length; index += 1) {",
    "    if (node !== null && typeof node === \"object\" && Object.prototype.hasOwnProperty.call(node, path[index])) { node = node[path[index]]; } else { found = false; break; }",
    "  }",
    `  pm.expect(found).to.equal(${presence});`,
    "});",
  ];
}

/** The lines of one condition's test, or undefined when no template can express it faithfully. */
export function securityConditionLines(condition: EvaluationCondition): string[] | undefined {
  switch (condition.kind) {
    case "status.not-success":
      return ['pm.test("Status code is not a success (2xx)", function () {', "  pm.expect(pm.response.code).to.not.be.within(200, 299);", "});"];
    case "status.in-set": {
      const codes = condition.codes.map(statusNumber);
      if (codes.length === 0 || codes.length > MAX_CODES || codes.some((code) => code === undefined)) return undefined;
      return [`pm.test(${JSON.stringify(`Status code is one of ${codes.join(", ")}`)}, function () {`, `  pm.expect(${JSON.stringify(codes)}).to.include(pm.response.code);`, "});"];
    }
    case "status.equals": {
      const code = statusNumber(condition.code);
      return code === undefined ? undefined : [`pm.test("Status code is ${code}", function () {`, `  pm.expect(pm.response.code).to.equal(${code});`, "});"];
    }
    case "status.not-equals": {
      const code = statusNumber(condition.code);
      return code === undefined ? undefined : [`pm.test("Status code is not ${code}", function () {`, `  pm.expect(pm.response.code).to.not.equal(${code});`, "});"];
    }
    case "header.present":
    case "header.absent": {
      if (!HEADER_NAME.test(condition.name)) return undefined;
      const present = condition.kind === "header.present";
      return [
        `pm.test(${JSON.stringify(`The ${condition.name} header is ${present ? "present" : "absent"}`)}, function () {`,
        `  pm.expect(pm.response.headers.has(${JSON.stringify(condition.name)})).to.equal(${present});`,
        "});",
      ];
    }
    case "body.field-present":
    case "body.field-absent": {
      const segments = fieldSegments(condition.path);
      if (!segments) return undefined;
      const present = condition.kind === "body.field-present";
      return fieldLines(segments, present, `The body ${present ? "has" : "has no"} ${segments.join(".")} field`);
    }
    case "header.value-not-contains":
    case "body.not-match-leak-pattern":
    case "repeat.limit-engaged":
    case "persisted.field-unchanged":
      return undefined;
  }
}

export interface SecurityAssertions {
  /** The test event holding every expressed condition, absent when none could be expressed. */
  readonly event?: PostmanEvent;
  readonly expressed: readonly EvaluationCondition[];
  readonly notExpressed: readonly EvaluationCondition[];
}

/** One test event for a scenario's conditions, and the conditions no template could express. */
export function securityAssertions(conditions: readonly EvaluationCondition[]): SecurityAssertions {
  const lines: string[] = [];
  const expressed: EvaluationCondition[] = [];
  const notExpressed: EvaluationCondition[] = [];
  for (const condition of conditions) {
    const conditionLines = securityConditionLines(condition);
    if (conditionLines) {
      lines.push(...conditionLines);
      expressed.push(condition);
    } else {
      notExpressed.push(condition);
    }
  }
  return { ...(lines.length > 0 ? { event: { listen: "test" as const, script: { type: "text/javascript" as const, exec: lines } } } : {}), expressed, notExpressed };
}
