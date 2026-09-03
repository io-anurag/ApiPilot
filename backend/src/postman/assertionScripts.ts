import type {
  Assertion,
  GenerationLimitation,
  PostmanEvent,
  SchemaConstraint,
  TestScenario,
} from "@apipilot/shared-domain";

/**
 * Translates the assertions an approved scenario already carries into executable checks
 * (FR-006). Nothing is added: an assertion the scenario did not carry is never emitted, and a
 * status code the specification did not document is never invented (constitution I).
 */

const WILDCARD_STATUS = /^([1-5])XX$/i;

/** Converts a `SchemaConstraint` to JSON Schema, copying only what was actually declared. */
export function toJsonSchema(constraint: SchemaConstraint): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  if (constraint.type !== undefined) schema.type = constraint.type;
  if (constraint.enum !== undefined) schema.enum = constraint.enum;
  if (constraint.format !== undefined) schema.format = constraint.format;
  if (constraint.minimum !== undefined) schema.minimum = constraint.minimum;
  if (constraint.maximum !== undefined) schema.maximum = constraint.maximum;
  if (constraint.pattern !== undefined) schema.pattern = constraint.pattern;
  if (constraint.minLength !== undefined) schema.minLength = constraint.minLength;
  if (constraint.maxLength !== undefined) schema.maxLength = constraint.maxLength;
  if (constraint.minItems !== undefined) schema.minItems = constraint.minItems;
  if (constraint.maxItems !== undefined) schema.maxItems = constraint.maxItems;

  const propertyNames = Object.keys(constraint.properties);
  if (propertyNames.length > 0) {
    schema.properties = Object.fromEntries(
      propertyNames.map((name) => [name, toJsonSchema(constraint.properties[name])]),
    );
  }
  if (constraint.items !== undefined) schema.items = toJsonSchema(constraint.items);
  if (constraint.required.length > 0) schema.required = [...constraint.required];
  return schema;
}

export interface AssertionTranslation {
  event?: PostmanEvent;
  limitations: GenerationLimitation[];
}

function statusCodeLines(code: string): string[] {
  const wildcard = WILDCARD_STATUS.exec(code);
  if (wildcard) {
    const lower = Number(wildcard[1]) * 100;
    return [
      `pm.test("Status code is in the ${code.toUpperCase()} class", function () {`,
      `  pm.expect(pm.response.code).to.be.at.least(${lower});`,
      `  pm.expect(pm.response.code).to.be.below(${lower + 100});`,
      "});",
    ];
  }
  return [
    `pm.test("Status code is ${code}", function () {`,
    `  pm.response.to.have.status(${Number(code)});`,
    "});",
  ];
}

function schemaLines(schema: SchemaConstraint, index: number): string[] {
  const name = `expectedSchema${index}`;
  return [
    `const ${name} = ${JSON.stringify(toJsonSchema(schema), null, 2)};`,
    `pm.test("Response body conforms to the documented schema", function () {`,
    `  pm.response.to.have.jsonSchema(${name});`,
    "});",
  ];
}

function isExactStatusCode(code: string): boolean {
  return /^[1-5][0-9]{2}$/.test(code);
}

/**
 * One `test` event carrying every translatable assertion, plus the limitations recorded for
 * assertions that carry no expressible expectation. An assertion set that translates to
 * nothing produces no event at all rather than an empty script.
 */
export function translateAssertions(scenario: TestScenario): AssertionTranslation {
  const location = `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`;
  const limitations: GenerationLimitation[] = [];
  const lines: string[] = [];

  if (scenario.assertions.length === 0) {
    limitations.push({
      kind: "no-expected-outcome",
      scenarioId: scenario.id,
      location,
      message:
        "The approved scenario carried no assertion, so the request is generated with no expected outcome.",
    });
    return { limitations };
  }

  scenario.assertions.forEach((assertion: Assertion, index) => {
    if (assertion.type === "status-code") {
      const code = assertion.expectedStatusCode;
      if (code !== undefined && (isExactStatusCode(code) || WILDCARD_STATUS.test(code))) {
        lines.push(...statusCodeLines(code));
        return;
      }
      limitations.push({
        kind: "undocumented-status-code",
        scenarioId: scenario.id,
        location,
        message: `The specification documents the response as "${code ?? "unspecified"}", which carries no status information, so no status check is asserted.`,
      });
      return;
    }
    if (assertion.expectedSchema !== undefined) {
      lines.push(...schemaLines(assertion.expectedSchema, index));
    }
  });

  if (lines.length === 0) return { limitations };

  return {
    event: { listen: "test", script: { type: "text/javascript", exec: lines } },
    limitations,
  };
}