import { describe, expect, it } from "vitest";
import type { BodyEdit, IntegrationWorkflow, PerformancePlan, TestScenario } from "@apipilot/shared-domain";
import { renderScript } from "../../../src/performance/k6/renderScript";
import { InvalidBodyEditError } from "../../../src/performance/errors";
import { effectiveScenario, jsonErrorOffset, validateBodyEdits } from "../../../src/performance/plan/bodyEdits";
import { buildPlan, rebuildPlan } from "../../../src/performance/plan/buildPlan";
import { stepRequestFor } from "../../../src/performance/plan/planStepRequest";
import { applyPlanUpdate, InvalidPlanUpdateError } from "../../../src/performance/plan/planUpdate";
import { buildRemovedOperationPreview } from "../../../src/performance/plan/removedOperationPreview";
import { buildStepRequestPreview } from "../../../src/performance/plan/requestPreview";
import { planAuth, type PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { workflowVariableName } from "../../../src/postman/workflowRendering";
import { bodyEditsContext, quickContext } from "../../fixtures/performance/context";

/** AP-033 (specs/033-edit-step-request-body research R1 to R9, tasks T004, T016, T033, T042). */

async function scenarioFor(operationKey: string): Promise<TestScenario> {
  const context = await bodyEditsContext();
  return context.approvedScenarios.find((scenario) => `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}` === operationKey)!;
}

function jsonEdit(scenario: TestScenario, json: unknown): BodyEdit {
  return { stepId: "s_test", operationKey: "POST /orders", scenarioId: scenario.id, kind: "json", json };
}

async function setup() {
  const context = await bodyEditsContext();
  const plan = buildPlan(context);
  const steps = plan.journeys.flatMap((journey) => journey.steps);
  const stepOf = (operationKey: string) => steps.find((step) => step.operationKey === operationKey)!;
  return { context, plan, stepOf };
}

function refusal(run: () => unknown): InvalidBodyEditError {
  try {
    run();
  } catch (err) {
    if (err instanceof InvalidBodyEditError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("effectiveScenario", () => {
  it("returns the same scenario when there is no edit", async () => {
    const scenario = await scenarioFor("POST /orders");
    expect(effectiveScenario(scenario, undefined)).toBe(scenario);
  });

  it("replaces the body with a JSON edit's value", async () => {
    const scenario = await scenarioFor("POST /orders");
    const result = effectiveScenario(scenario, jsonEdit(scenario, { quantity: 3 }));
    expect(result.request.body).toEqual({ quantity: 3 });
    expect(result.request.pathParameters).toBe(scenario.request.pathParameters);
  });

  it("replaces the body with a text edit's string", async () => {
    const scenario = await scenarioFor("POST /notes");
    const edit: BodyEdit = { stepId: "s_test", operationKey: "POST /notes", scenarioId: scenario.id, kind: "text", text: "Load note" };
    expect(effectiveScenario(scenario, edit).request.body).toBe("Load note");
  });

  it("never mutates the input scenario", async () => {
    const scenario = await scenarioFor("POST /orders");
    const before = structuredClone(scenario);
    effectiveScenario(scenario, jsonEdit(scenario, { quantity: 3 }));
    expect(scenario).toEqual(before);
  });
});

/** AP-033 research R6 checks 1 to 4 (tasks T016). */
describe("validateBodyEdits", () => {
  it("refuses a malformed entry as invalid_request", async () => {
    const { context, plan, stepOf } = await setup();
    const id = stepOf("POST /orders").id;
    expect(() => validateBodyEdits(plan, context, [])).toThrow(InvalidPlanUpdateError);
    expect(() => validateBodyEdits(plan, context, { [id]: { kind: "xml", text: "<a/>" } })).toThrow(InvalidPlanUpdateError);
    expect(() => validateBodyEdits(plan, context, { [id]: { kind: "json", text: 3 } })).toThrow(InvalidPlanUpdateError);
  });

  it("refuses an unknown step, and a removed operation's step, as invalid_body_edit", async () => {
    const { context, plan, stepOf } = await setup();
    expect(refusal(() => validateBodyEdits(plan, context, { s_nope: { kind: "json", text: "{}" } }))).toMatchObject({
      code: "invalid_body_edit",
      stepId: "s_nope",
    });
    const notes = stepOf("POST /notes");
    const removed = applyPlanUpdate(plan, { excludedOperationKeys: ["POST /notes"] }, context);
    expect(refusal(() => validateBodyEdits(removed, context, { [notes.id]: { kind: "text", text: "x" } })).code).toBe("invalid_body_edit");
  });

  it("refuses a body the operation does not accept as body_not_accepted", async () => {
    const { context, plan, stepOf } = await setup();
    const cases = [
      ["GET /errors/conflict", "json"],
      ["POST /uploads", "json"],
      ["POST /orders", "text"],
      ["POST /notes", "json"],
    ] as const;
    for (const [operationKey, kind] of cases) {
      const step = stepOf(operationKey);
      expect(refusal(() => validateBodyEdits(plan, context, { [step.id]: { kind, text: "{}" } }))).toMatchObject({
        code: "body_not_accepted",
        stepId: step.id,
      });
    }
  });

  it("refuses more than 64 KiB in UTF-8 as body_too_large, and accepts exactly 64 KiB", async () => {
    const { context, plan, stepOf } = await setup();
    const id = stepOf("POST /notes").id;
    const exact = "é".repeat(32_768);
    expect(Buffer.byteLength(exact, "utf8")).toBe(65_536);
    expect(validateBodyEdits(plan, context, { [id]: { kind: "text", text: exact } })).toHaveLength(1);
    expect(refusal(() => validateBodyEdits(plan, context, { [id]: { kind: "text", text: `${exact}a` } }))).toMatchObject({
      code: "body_too_large",
      extra: { limitBytes: 65_536 },
    });
  });

  it("refuses JSON that does not parse as invalid_body, always with a line and column, never quoting the text", async () => {
    const { context, plan, stepOf } = await setup();
    const id = stepOf("POST /orders").id;
    const at = (text: string) => refusal(() => validateBodyEdits(plan, context, { [id]: { kind: "json", text } }));
    const missingValue = at('{"quantity": }');
    expect(missingValue).toMatchObject({ code: "invalid_body", extra: { line: 1, column: 14 } });
    expect(missingValue.message).toBe("Not valid JSON at line 1, column 14.");
    expect(missingValue.message).not.toContain("quantity");
    expect(at('{"quantity": 1').extra).toEqual({ line: 1, column: 15 });
    expect(at('{\n  "quantity": 1,\n  "status": nope\n}').extra).toEqual({ line: 3, column: 13 });
    expect(at("").extra).toEqual({ line: 1, column: 1 });
  });

  it("locates an error in a 64 KiB body in one pass", async () => {
    const { context, plan, stepOf } = await setup();
    const id = stepOf("POST /orders").id;
    const text = `[${"1,".repeat(32_766)}x]`;
    const started = performance.now();
    expect(refusal(() => validateBodyEdits(plan, context, { [id]: { kind: "json", text } })).code).toBe("invalid_body");
    expect(jsonErrorOffset(text)).toBe(text.length - 2);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("refuses a body nested deeper than 50 levels without exhausting the stack", async () => {
    const { context, plan, stepOf } = await setup();
    const id = stepOf("POST /orders").id;
    const deep = `${"[".repeat(30_000)}${"]".repeat(30_000)}`;
    expect(refusal(() => validateBodyEdits(plan, context, { [id]: { kind: "json", text: deep } })).code).toBe("invalid_body");
    expect(jsonErrorOffset("[".repeat(30_000))).toBe(30_000);
  });

  it("accepts any JSON value, including a top-level number", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf("POST /orders");
    expect(validateBodyEdits(plan, context, { [step.id]: { kind: "json", text: "3" } })).toEqual([
      { stepId: step.id, operationKey: "POST /orders", scenarioId: step.scenarioId, kind: "json", json: 3 },
    ]);
  });

  it("stores the parsed value, resets with null, and stores no edit equal to the generated body", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf("POST /orders");
    const edits = validateBodyEdits(plan, context, { [step.id]: { kind: "json", text: '{ "quantity" : 3 }' } });
    expect(edits).toEqual([{ stepId: step.id, operationKey: "POST /orders", scenarioId: step.scenarioId, kind: "json", json: { quantity: 3 } }]);
    expect(validateBodyEdits({ ...plan, bodyEdits: edits }, context, { [step.id]: null })).toEqual([]);
    const generated = context.approvedScenarios.find((scenario) => scenario.id === step.scenarioId)!.request.body;
    expect(validateBodyEdits(plan, context, { [step.id]: { kind: "json", text: JSON.stringify(generated) } })).toEqual([]);
    expect(validateBodyEdits(plan, context, { [stepOf("POST /notes").id]: { kind: "text", text: "a" } })).toEqual([]);
  });

  it("applies nothing when one entry fails", async () => {
    const { context, plan, stepOf } = await setup();
    const before = structuredClone(plan);
    const update = {
      thinkTimeMs: 500,
      bodyEdits: { [stepOf("POST /orders").id]: { kind: "json", text: "{}" }, [stepOf("POST /notes").id]: { kind: "json", text: "{}" } },
    };
    expect(() => applyPlanUpdate(plan, update, context)).toThrow(InvalidBodyEditError);
    expect(plan).toEqual(before);
  });

  it("saves through applyPlanUpdate, marks the step and clears discarded notices", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf("POST /orders");
    const updated = applyPlanUpdate(
      { ...plan, discardedBodyEdits: ["POST /gone"] },
      { bodyEdits: { [step.id]: { kind: "json", text: '{"quantity": 3}' } } },
      context,
    );
    expect(updated.bodyEdits).toHaveLength(1);
    expect(updated.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.id === step.id)?.bodyEdited).toBe(true);
    expect(updated.discardedBodyEdits).toEqual([]);
    expect(updated.fingerprint).not.toBe(plan.fingerprint);
  });
});

/** A two-step workflow in which POST /orders consumes a value in its body (research R4). */
const WORKFLOW: IntegrationWorkflow = {
  id: "wf-accounts-orders",
  steps: [
    { position: 0, operationMethod: "POST", operationPath: "/accounts", producesVariableNames: ["shipCity"], consumesVariableNames: [] },
    { position: 1, operationMethod: "POST", operationPath: "/orders", producesVariableNames: [], consumesVariableNames: ["shipCity"] },
  ],
  variables: [
    { name: "shipCity", producerStepIndex: 0, producerField: "name", consumerStepIndex: 1, consumerLocation: "body", consumerField: "shipping.city", relationshipId: "r-ship" },
  ],
  relationshipIds: ["r-ship"],
};

async function workflowSetup() {
  const context: PerformanceContext = { ...(await bodyEditsContext()), workflows: [WORKFLOW], source: "guided" };
  const plan = buildPlan(context);
  const orders = plan.journeys.flatMap((journey) => journey.steps).find((step) => step.operationKey === "POST /orders")!;
  return { context, plan, orders };
}

function sentBody(plan: PerformancePlan, context: PerformanceContext, stepId: string): Record<string, unknown> {
  return JSON.parse(stepRequestFor(plan, context, planAuth(context), stepId).built.template.body!);
}

/** AP-033 research R4, R6 checks 5 and 6, R8 (tasks T033). */
describe("references and secrets in an edited body", () => {
  it("refuses a reserved name as reserved_reference, naming it", async () => {
    const { context, plan, stepOf } = await setup();
    const id = stepOf("POST /orders").id;
    const unique = refusal(() => validateBodyEdits(plan, context, { [id]: { kind: "json", text: '{"customerEmail": "{{apipilot_unique_0}}"}' } }));
    expect(unique).toMatchObject({ code: "reserved_reference", extra: { reference: "apipilot_unique_0" } });

    const workflow = await workflowSetup();
    const variable = workflowVariableName(WORKFLOW.id, "shipCity");
    expect(refusal(() => validateBodyEdits(workflow.plan, workflow.context, { [workflow.orders.id]: { kind: "json", text: `{"note": "{{${variable}}}"}` } })).extra).toEqual({ reference: variable });

    const quick = await quickContext();
    const quickPlan = buildPlan(quick);
    const tokenVariable = [...planAuth(quick).tokenSources.values()][0].tokenVariable;
    const quickOrders = quickPlan.journeys.flatMap((journey) => journey.steps).find((step) => step.operationKey === "POST /orders")!;
    expect(refusal(() => validateBodyEdits(quickPlan, quick, { [quickOrders.id]: { kind: "json", text: `{"note": "{{${tokenVariable}}}"}` } }))).toMatchObject({
      code: "reserved_reference",
      extra: { reference: tokenVariable },
    });
  });

  it("refuses any literal in a format: password field, including the generated value left unchanged (FR-012a)", async () => {
    const { context, plan, stepOf } = await setup();
    const id = stepOf("POST /accounts").id;
    const literal = refusal(() => validateBodyEdits(plan, context, { [id]: { kind: "json", text: '{"name": "a", "pin": "1234"}' } }));
    expect(literal).toMatchObject({ code: "body_secret_literal", extra: { fieldPath: "pin" } });
    expect(literal.message).not.toContain("1234");
    // Only `name` changed; the generated `pin` is still a literal.
    expect(refusal(() => validateBodyEdits(plan, context, { [id]: { kind: "json", text: '{"name": "b", "pin": "a"}' } })).code).toBe("body_secret_literal");
    expect(validateBodyEdits(plan, context, { [id]: { kind: "json", text: '{"name": "a", "pin": "{{accountPin}}"}' } })).toHaveLength(1);
    expect(validateBodyEdits(plan, context, { [id]: { kind: "json", text: '{"name": "b"}' } })).toHaveLength(1);
  });

  it("checks a nested format: password field too", async () => {
    const { context, plan, stepOf } = await setup();
    const accounts = context.apiModel.operations.find((operation) => operation.path === "/accounts")!;
    const schema = accounts.requestBody!.contentTypes["application/json"];
    const nested: PerformanceContext = {
      ...context,
      apiModel: {
        ...context.apiModel,
        operations: context.apiModel.operations.map((operation) =>
          operation === accounts
            ? { ...operation, requestBody: { ...operation.requestBody!, contentTypes: { "application/json": { ...schema, properties: { ...schema.properties, login: { type: "object", required: [], properties: { secret: { type: "string", format: "password", required: [], properties: {} } } } } } } } }
            : operation,
        ),
      },
    };
    const id = stepOf("POST /accounts").id;
    expect(refusal(() => validateBodyEdits(plan, nested, { [id]: { kind: "json", text: '{"pin": "{{p}}", "login": {"secret": "x"}}' } })).extra).toEqual({ fieldPath: "login.secret" });
  });

  it("stops applying a workflow variable whose field the edit removed, without re-creating it, and says so (FR-010)", async () => {
    const { context, plan, orders } = await workflowSetup();
    expect(sentBody(plan, context, orders.id).shipping).toEqual({ city: `{{${workflowVariableName(WORKFLOW.id, "shipCity")}}}` });
    const edited = applyPlanUpdate(plan, { bodyEdits: { [orders.id]: { kind: "json", text: '{"quantity": 2, "customerEmail": "a@example.com"}' } } }, context);
    expect(sentBody(edited, context, orders.id)).not.toHaveProperty("shipping");
    expect(edited.bodyEditNotices).toEqual([{ stepId: orders.id, kind: "workflow-variable-dropped", name: "shipCity" }]);

    const kept = applyPlanUpdate(plan, { bodyEdits: { [orders.id]: { kind: "json", text: '{"quantity": 2, "customerEmail": "a@example.com", "shipping": {"city": "x"}}' } } }, context);
    expect(sentBody(kept, context, orders.id).shipping).toEqual({ city: `{{${workflowVariableName(WORKFLOW.id, "shipCity")}}}` });
    expect(kept.bodyEditNotices).toEqual([]);
  });

  it("lists the fields ApiPilot fills at run time for the editor, never the engineer's own references (FR-009)", async () => {
    const { context, plan, orders } = await workflowSetup();
    const edited = applyPlanUpdate(
      plan,
      { bodyEdits: { [orders.id]: { kind: "json", text: '{"quantity": 2, "customerEmail": "a@example.com", "shipping": {"city": "x"}, "note": "{{noteTag}}"}' } } },
      context,
    );
    const replacements = buildStepRequestPreview(edited, context, orders.id).bodyEdit!.replacements;
    expect(replacements.map((entry) => [entry.fieldPath, entry.reference.kind])).toEqual([
      ["customerEmail", "unique-per-iteration"],
      ["shipping.city", "workflow-variable"],
    ]);
  });

  it("stops varying a unique field the edit removed, and says so (FR-010)", async () => {
    const { context, plan, stepOf } = await setup();
    const orders = stepOf("POST /orders");
    const edited = applyPlanUpdate(plan, { bodyEdits: { [orders.id]: { kind: "json", text: '{"quantity": 2}' } } }, context);
    expect(edited.uniqueValueFields).toEqual([]);
    expect(edited.bodyEditNotices).toEqual([{ stepId: orders.id, kind: "unique-field-dropped", name: "customerEmail" }]);
  });

  it("lists an engineer's reference as a body-reference value, secret only in a password field (FR-011, R4)", async () => {
    const { context, plan, stepOf } = await setup();
    const orders = stepOf("POST /orders");
    const accounts = stepOf("POST /accounts");
    const edited = applyPlanUpdate(
      plan,
      {
        bodyEdits: {
          [orders.id]: { kind: "json", text: '{"quantity": 2, "warehouseId": "{{warehouseId}}"}' },
          [accounts.id]: { kind: "json", text: '{"name": "a", "pin": "{{accountPin}}"}' },
        },
      },
      context,
    );
    expect(edited.journeys.flatMap((journey) => journey.steps).find((step) => step.id === orders.id)?.requiredValues).toContain("warehouseId");
    expect(edited.userSuppliedValues.find((value) => value.name === "warehouseId")).toMatchObject({ source: "body-reference", secret: false, neededBySteps: [orders.id] });
    expect(edited.userSuppliedValues.find((value) => value.name === "accountPin")).toMatchObject({ source: "body-reference", secret: true });
    expect(Object.keys(JSON.parse(renderScript(edited, context).environmentTemplate))).toEqual(expect.arrayContaining(["warehouseId", "accountPin"]));

    const removed = applyPlanUpdate(edited, { bodyEdits: { [orders.id]: null } }, context);
    expect(removed.userSuppliedValues.map((value) => value.name)).not.toContain("warehouseId");
    expect(Object.keys(JSON.parse(renderScript(removed, context).environmentTemplate))).not.toContain("warehouseId");
  });

  it("keeps a name secret when it is also a credential elsewhere in the plan", async () => {
    const quick = await quickContext();
    const plan = buildPlan(quick);
    const credential = plan.userSuppliedValues.find((value) => value.source === "credential" && value.secret)!;
    const orders = plan.journeys.flatMap((journey) => journey.steps).find((step) => step.operationKey === "POST /orders")!;
    const edited = applyPlanUpdate(plan, { bodyEdits: { [orders.id]: { kind: "json", text: `{"note": "{{${credential.name}}}"}` } } }, quick);
    expect(edited.userSuppliedValues.find((value) => value.name === credential.name)?.secret).toBe(true);
  });
});

/** AP-033 FR-017, FR-018 (research R9; tasks T042). */
describe("body edits across plan changes", () => {
  async function editedOrders() {
    const { context, plan, stepOf } = await setup();
    const orders = stepOf("POST /orders");
    const edited = applyPlanUpdate(plan, { bodyEdits: { [orders.id]: { kind: "json", text: '{"quantity": 7}' } } }, context);
    return { context, edited, orders, stepOf };
  }

  it("keeps an edit while its operation is removed, and brings it back on restore", async () => {
    const { context, edited, orders } = await editedOrders();
    const removed = applyPlanUpdate(edited, { excludedOperationKeys: [...edited.excludedOperationKeys, "POST /orders"] }, context);
    expect(removed.journeys.flatMap((journey) => journey.steps).some((step) => step.id === orders.id)).toBe(false);
    expect(removed.bodyEdits).toHaveLength(1);

    const preview = buildRemovedOperationPreview(removed, context, "POST /orders");
    expect(preview.step.bodyEdited).toBe(true);
    expect(JSON.parse(preview.request.body!.text)).toEqual({ quantity: 7 });

    const restored = applyPlanUpdate(removed, { excludedOperationKeys: edited.excludedOperationKeys }, context);
    const step = restored.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.id === orders.id)!;
    expect(step.bodyEdited).toBe(true);
    // A restored journey goes to the end of the plan (existing restore behavior), so only the edit is compared.
    expect(restored.bodyEdits).toEqual(edited.bodyEdits);
  });

  it("keeps edits through Reset plan, which resets only the order", async () => {
    const { context, edited } = await editedOrders();
    expect(rebuildPlan(edited, context, { keepOrder: false }).bodyEdits).toEqual(edited.bodyEdits);
  });

  it("discards an edit when a rebuild gives the step a different scenario, names the operation, and clears the note on the next edit", async () => {
    const { context, edited } = await editedOrders();
    const changed: PerformanceContext = {
      ...context,
      approvedScenarios: context.approvedScenarios.map((scenario) => (scenario.operationPath === "/orders" ? { ...scenario, id: `${scenario.id}-revised` } : scenario)),
    };
    const rebuilt = rebuildPlan(edited, changed, { keepOrder: true });
    expect(rebuilt.bodyEdits).toEqual([]);
    expect(rebuilt.discardedBodyEdits).toEqual(["POST /orders"]);
    expect(rebuilt.journeys.flatMap((journey) => journey.steps).some((step) => step.bodyEdited)).toBe(false);
    expect(applyPlanUpdate(rebuilt, { thinkTimeMs: 0 }, changed).discardedBodyEdits).toEqual([]);
  });

  it("resets every edited step in one update", async () => {
    const { context, edited, stepOf } = await editedOrders();
    const notes = stepOf("POST /notes");
    const twice = applyPlanUpdate(edited, { bodyEdits: { [notes.id]: { kind: "text", text: "Load note" } } }, context);
    expect(twice.bodyEdits).toHaveLength(2);
    const reset = applyPlanUpdate(twice, { bodyEdits: Object.fromEntries(twice.bodyEdits.map((edit) => [edit.stepId, null])) }, context);
    expect(reset.bodyEdits).toEqual([]);
    expect(reset.fingerprint).toBe(buildPlan(context).fingerprint);
  });
});
