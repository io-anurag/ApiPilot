import { describe, expect, it } from "vitest";
import type { PreviewValue, StepRequestPreview } from "@apipilot/shared-domain";
import { StepNotFoundError } from "../../../src/performance/errors";
import { buildPlan } from "../../../src/performance/plan/buildPlan";
import { buildStepRequestPreview, previewValueOf } from "../../../src/performance/plan/requestPreview";
import { SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { bodyEditsContext, performanceContext, quickContext } from "../../fixtures/performance/context";

/** AP-032 FR-008, US1 AS7 (specs/032-quick-performance-test research Q8, tasks T018). */

async function previewOf(operationKey: string, context?: Awaited<ReturnType<typeof quickContext>>): Promise<StepRequestPreview> {
  const resolved = context ?? (await quickContext());
  const plan = buildPlan(resolved);
  const step = plan.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.operationKey === operationKey)!;
  return buildStepRequestPreview(plan, resolved, step.id);
}

describe("buildStepRequestPreview", () => {
  it("shows the method, path template, and a path parameter no operation produces as an environment value", async () => {
    const preview = await previewOf("GET /orders/{orderId}");
    expect(preview.method).toBe("GET");
    expect(preview.pathTemplate).toBe("/orders/{orderId}");
    const orderId = preview.parameters.find((parameter) => parameter.location === "path" && parameter.name === "orderId")!;
    expect(orderId.value).toMatchObject({ kind: "environment", secret: false });
  });

  it("shows a generated query value as text", async () => {
    const preview = await previewOf("GET /orders");
    const state = preview.parameters.find((parameter) => parameter.location === "query" && parameter.name === "state");
    if (state) expect(state.value.kind).toBe("generated");
    expect(preview.parameters.every((parameter) => parameter.location !== "path")).toBe(true);
  });

  it("marks the email body field as unique per virtual user and iteration", async () => {
    const preview = await previewOf("POST /orders");
    expect(preview.body?.contentType).toBe("json");
    expect(preview.body?.references).toEqual([expect.objectContaining({ kind: "unique-per-iteration", format: "email" })]);
  });

  it("shows the bearer token acquired by the plan's login as a credential, never as an environment value", async () => {
    const preview = await previewOf("GET /products");
    expect(preview.auth.kind).toBe("chained-login");
    expect(preview.auth.location).toBe("header");
    expect(preview.auth.references).toEqual([expect.objectContaining({ kind: "credential", schemeName: "LoginAuth" })]);
  });

  it("shows a static credential by name only, marked secret", async () => {
    const context = await quickContext("guided");
    const withoutLogin = { ...context, apiModel: { ...context.apiModel, operations: context.apiModel.operations.filter((operation) => operation.path !== "/auth/login") } };
    const preview = await previewOf("GET /products", withoutLogin);
    expect(preview.auth.kind).toBe("static-credential");
    expect(preview.auth.references).toEqual([expect.objectContaining({ kind: "environment", secret: true })]);
  });

  it("shows a guided workflow step's consumed variable with its producing step", async () => {
    const context = await performanceContext();
    const plan = buildPlan(context);
    const [producer, consumer] = plan.journeys[0].steps;
    const preview = buildStepRequestPreview(plan, context, consumer.id);
    const orderId = preview.parameters.find((parameter) => parameter.location === "path")!;
    expect(orderId.value).toMatchObject({ kind: "workflow-variable", variable: "orderId", producerStepId: producer.id });
  });

  it("classifies text that mixes a value and references as a template", () => {
    const value: PreviewValue = previewValueOf("Bearer {{token}} ok", (name) => ({ kind: "environment", name, secret: true }));
    expect(value).toEqual({ kind: "template", text: "Bearer {{token}} ok", references: [{ kind: "environment", name: "token", secret: true }] });
    expect(previewValueOf("plain", () => ({ kind: "environment", name: "x", secret: false }))).toEqual({ kind: "generated", text: "plain" });
  });

  it("refuses a step that is not in the plan", async () => {
    const context = await quickContext();
    expect(() => buildStepRequestPreview(buildPlan(context), context, "s_missing")).toThrow(StepNotFoundError);
  });

  it("contains no environment value: it never reads an environment", async () => {
    const context = await quickContext();
    const plan = buildPlan(context);
    const previews = plan.journeys.flatMap((journey) => journey.steps).map((step) => buildStepRequestPreview(plan, context, step.id));
    expect(JSON.stringify(previews)).not.toContain(SEEDED_CLIENT_SECRET);
    expect(previews).toHaveLength(plan.journeys.length);
  });
});

/** AP-033 FR-001 (specs/033-edit-step-request-body research R12, tasks T011). */
describe("the body a step sends", () => {
  async function bodyPreviewOf(operationKey: string, context?: Awaited<ReturnType<typeof bodyEditsContext>>): Promise<StepRequestPreview> {
    return previewOf(operationKey, context ?? (await bodyEditsContext()));
  }

  it("says an operation without a documented body has none, and offers no editor", async () => {
    const preview = await bodyPreviewOf("GET /errors/conflict");
    expect(preview.bodyStatus).toBe("not-documented");
    expect(preview.body).toBeNull();
    expect(preview.bodyEdit).toBeNull();
  });

  it("gives the editor the generated base body, before ApiPilot's substitutions", async () => {
    const context = await bodyEditsContext();
    const preview = await bodyPreviewOf("POST /orders", context);
    const scenario = context.approvedScenarios.find((candidate) => candidate.operationPath === "/orders")!;
    expect(preview.bodyStatus).toBe("sent");
    expect(preview.body?.text).toContain("{{apipilot_unique_0}}");
    expect(preview.bodyEdit).toEqual({
      kind: "json",
      text: JSON.stringify(scenario.request.body, null, 2),
      edited: false,
      mismatches: [],
      replacements: [{ fieldPath: "customerEmail", reference: { kind: "unique-per-iteration", name: "apipilot_unique_0", format: "email" } }],
    });
    expect(preview.bodyEdit?.text).not.toContain("{{apipilot_unique_0}}");
  });

  it("says an operation with a documented body that this step does not send, with an empty editor", async () => {
    const context = await bodyEditsContext({
      mutateScenarios: (scenarios) =>
        scenarios.map((scenario) =>
          scenario.operationPath === "/profiles/{profileId}" ? { ...scenario, request: { ...scenario.request, body: undefined } } : scenario,
        ),
    });
    const preview = await bodyPreviewOf("PATCH /profiles/{profileId}", context);
    expect(preview.bodyStatus).toBe("documented-not-sent");
    expect(preview.body).toBeNull();
    expect(preview.bodyEdit).toEqual({ kind: "json", text: "", edited: false, mismatches: [], replacements: [] });
  });

  it("does not offer to edit a form or multipart body", async () => {
    const preview = await bodyPreviewOf("POST /uploads");
    expect(preview.bodyStatus).toBe("unsupported-content-type");
    expect(preview.bodyEdit).toBeNull();
  });

  it("edits a text/* body as text", async () => {
    const preview = await bodyPreviewOf("POST /notes");
    expect(preview.bodyStatus).toBe("sent");
    expect(preview.bodyEdit).toMatchObject({ kind: "text", text: "a", edited: false });
  });
});
