import type {
  Assertion,
  GenerationLimitation,
  PostmanEvent,
  SchemaConstraint,
  TestScenario,
} from "@apipilot/shared-domain";
import { workflowVariableName } from "./workflowRendering";

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

/** Result of translating a scenario's assertions: the resulting test event, if any, plus limitations for assertions that had no expressible check. */
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

function statusTestName(code: string): string {
  const wildcard = WILDCARD_STATUS.exec(code);
  return wildcard
    ? `Status code is in the ${code.toUpperCase()} class`
    : `Status code is ${code}`;
}

export const SCHEMA_CONFORMANCE_TEST_NAME = "Response body conforms to the documented schema";

/** One assertion this scenario's script actually expresses, and which original assertion it came from. */
export interface AssertionTestPlanEntry {
  originalIndex: number;
  assertion: Assertion;
  /** The exact `pm.test(...)` name Newman reports this assertion under. */
  testName: string;
}

/**
 * The ordered list of assertions `translateAssertions()` actually emits a `pm.test(...)` for,
 * each paired with its `scenario.assertions` array index. Newman preserves `pm.test` invocation
 * order, so zipping this list positionally against one Newman execution's `assertions` array
 * recovers which original assertion each result belongs to
 * (`backend/src/execution/mapNewmanResult.ts`, research.md D5). Kept in this module, and used by
 * `translateAssertions()` itself below, so generation and execution can never disagree about
 * which assertions are expressible.
 */
export function assertionTestPlan(scenario: TestScenario): AssertionTestPlanEntry[] {
  const plan: AssertionTestPlanEntry[] = [];
  scenario.assertions.forEach((assertion, index) => {
    if (assertion.type === "status-code") {
      const code = assertion.expectedStatusCode;
      if (code !== undefined && (isExactStatusCode(code) || WILDCARD_STATUS.test(code))) {
        plan.push({ originalIndex: index, assertion, testName: statusTestName(code) });
      }
      return;
    }
    if (assertion.expectedSchema !== undefined) {
      plan.push({ originalIndex: index, assertion, testName: SCHEMA_CONFORMANCE_TEST_NAME });
    }
  });
  return plan;
}

/**
 * One `test` event carrying every translatable assertion, plus the limitations recorded for
 * assertions that carry no expressible expectation. An assertion set that translates to
 * nothing produces no event at all rather than an empty script.
 */
export function translateAssertions(scenario: TestScenario): AssertionTranslation {
  const location = `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`;
  const limitations: GenerationLimitation[] = [];

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

  const plan = assertionTestPlan(scenario);
  const plannedIndexes = new Set(plan.map((entry) => entry.originalIndex));

  scenario.assertions.forEach((assertion: Assertion, index) => {
    if (plannedIndexes.has(index) || assertion.type !== "status-code") return;
    limitations.push({
      kind: "undocumented-status-code",
      scenarioId: scenario.id,
      location,
      message: `The specification documents the response as "${assertion.expectedStatusCode ?? "unspecified"}", which carries no status information, so no status check is asserted.`,
    });
  });

  const lines = plan.flatMap((entry) =>
    entry.assertion.type === "status-code"
      ? statusCodeLines(entry.assertion.expectedStatusCode!)
      : schemaLines(entry.assertion.expectedSchema!, entry.originalIndex),
  );

  if (lines.length === 0) return { limitations };

  return {
    event: { listen: "test", script: { type: "text/javascript", exec: lines } },
    limitations,
  };
}

export interface WorkflowExtraction {
  workflowId: string;
  variableName: string;
  responseField: string;
}

function extractionLines(extraction: WorkflowExtraction): string[] {
  const access = extraction.responseField
    .split(".")
    .map((part) => `[${JSON.stringify(part)}]`)
    .join("");
  const variable = workflowVariableName(extraction.workflowId, extraction.variableName);
  // Environment scope, not collection scope: Newman's Node API only exposes a run's mutated
  // environment back to the caller (`summary.environment`), which is exactly what AP-017's
  // execution orchestrator needs to carry a workflow handoff forward from one item's Newman
  // invocation to the next (specs/018-test-execution-results research.md D2 addendum) — a
  // `pm.collectionVariables.set(...)` mutation is invisible outside the run that made it. This is
  // also what a human re-running the downloaded collection one request at a time in Postman's own
  // UI would expect, since Postman persists environment values across a session the same way.
  return [
    `pm.environment.set(${JSON.stringify(variable)}, workflowResponse${access});`,
  ];
}

export function appendWorkflowExtractions(
  event: PostmanEvent | undefined,
  extractions: WorkflowExtraction[],
): PostmanEvent | undefined {
  if (extractions.length === 0) return event;
  const lines = [
    `const workflowResponse = pm.response.json();`,
    ...extractions.flatMap(extractionLines),
  ];
  return {
    listen: "test",
    script: { type: "text/javascript", exec: [...(event?.script.exec ?? []), ...lines] },
  };
}