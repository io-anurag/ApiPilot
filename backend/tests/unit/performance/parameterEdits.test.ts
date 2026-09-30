import { describe, expect, it } from "vitest";
import type { ParameterEditEntry, PerformancePlan } from "@apipilot/shared-domain";
import { renderScript } from "../../../src/performance/k6/renderScript";
import { InvalidParameterEditError } from "../../../src/performance/errors";
import { buildPlan, rebuildPlan } from "../../../src/performance/plan/buildPlan";
import { applyParameterEdit, validateParameterEdits } from "../../../src/performance/plan/parameterEdits";
import { stepRequestFor } from "../../../src/performance/plan/planStepRequest";
import { applyPlanUpdate, InvalidPlanUpdateError } from "../../../src/performance/plan/planUpdate";
import { buildStepRequestPreview } from "../../../src/performance/plan/requestPreview";
import { planSnapshotForRun } from "../../../src/performance/plan/runSnapshot";
import { planAuth, type PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { parameterEditsContext, performanceContext } from "../../fixtures/performance/context";

/** AP-033 FR-020 to FR-022 (amended 2026-09-30): editing a step's path, query and header parameters. */

const POSTS = "GET /api/v1/posts";
const POST = "GET /api/v1/posts/{postId}";

async function setup() {
  const context = await parameterEditsContext();
  const plan = buildPlan(context);
  const stepOf = (current: PerformancePlan, operationKey: string) => current.journeys.flatMap((journey) => journey.steps).find((step) => step.operationKey === operationKey)!;
  return { context, plan, stepOf };
}

function save(plan: PerformancePlan, context: PerformanceContext, stepId: string, parameters: ParameterEditEntry[] | null): PerformancePlan {
  return applyPlanUpdate(plan, { parameterEdits: { [stepId]: parameters === null ? null : { parameters } } }, context);
}

function sentUrl(plan: PerformancePlan, context: PerformanceContext, stepId: string): string {
  return stepRequestFor(plan, context, planAuth(context), stepId).built.template.url;
}

function refusal(run: () => unknown): InvalidParameterEditError {
  try {
    run();
  } catch (err) {
    if (err instanceof InvalidParameterEditError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("the parameter editor's model", () => {
  it("lists every documented path, query and header parameter by location, then name, with what the scenario sends", async () => {
    const { context, plan, stepOf } = await setup();
    const model = buildStepRequestPreview(plan, context, stepOf(plan, POSTS).id).parameterEdit!;
    expect(model.edited).toBe(false);
    expect(model.rows.map((row) => `${row.location} ${row.name}`)).toEqual([
      "query limit",
      "query page",
      "query sort",
      "query tags",
      "query userId",
      "header X-Signing-Key",
      "header X-Tenant",
    ]);
    const row = (name: string) => model.rows.find((candidate) => candidate.name === name)!;
    expect(row("sort")).toMatchObject({ required: false, type: "string", enum: ["newest", "oldest"], notEditable: null, secret: false });
    expect(row("tags").notEditable).toBe("structured-value");
    expect(row("X-Signing-Key").secret).toBe(true);
    expect(row("X-Tenant").required).toBe(true);
    // A path parameter comes from the environment until it is edited.
    const path = buildStepRequestPreview(plan, context, stepOf(plan, POST).id).parameterEdit!.rows[0];
    expect(path).toMatchObject({ location: "path", name: "postId", required: true });
    expect(path.generated).toMatch(/^\{\{.+\}\}$/);
  });
});

describe("validateParameterEdits", () => {
  it("sets a value and leaves out an optional parameter, in the preview and in the script", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf(plan, POSTS);
    // The generator sends the enum's first value, `newest`, so the edit picks the other one.
    const edited = save(plan, context, step.id, [
      { location: "query", name: "sort", action: "set", value: "oldest" },
      { location: "query", name: "limit", action: "omit" },
    ]);
    const editedStep = stepOf(edited, POSTS);
    expect(editedStep.parametersEdited).toBe(true);
    expect(edited.parameterEdits).toEqual([
      {
        stepId: step.id,
        operationKey: POSTS,
        scenarioId: step.scenarioId,
        parameters: [
          { location: "query", name: "limit", action: "omit" },
          { location: "query", name: "sort", action: "set", value: "oldest" },
        ],
      },
    ]);
    const url = sentUrl(edited, context, step.id);
    expect(url).toContain("sort=oldest");
    expect(url).not.toContain("limit=");
    const preview = buildStepRequestPreview(edited, context, step.id);
    expect(preview.parameters.find((parameter) => parameter.name === "sort")?.value).toEqual({ kind: "generated", text: "oldest" });
    expect(preview.parameterEdit?.edited).toBe(true);
    expect(renderScript(edited, context).script).toContain("sort=oldest");
    expect(edited.fingerprint).not.toBe(plan.fingerprint);
  });

  it("keeps only real changes, resets with null, and restores the original fingerprint", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf(plan, POSTS);
    const generatedSort = buildStepRequestPreview(plan, context, step.id).parameterEdit!.rows.find((row) => row.name === "sort")!.generated;
    const same = save(plan, context, step.id, generatedSort === null ? [] : [{ location: "query", name: "sort", action: "set", value: generatedSort }]);
    expect(same.parameterEdits).toEqual([]);
    expect(same.fingerprint).toBe(plan.fingerprint);

    const edited = save(plan, context, step.id, [{ location: "header", name: "X-Tenant", action: "set", value: "tenant-a" }]);
    expect(stepRequestFor(edited, context, planAuth(context), step.id).built.template.headers).toContainEqual({ key: "X-Tenant", value: "tenant-a" });
    const reset = save(edited, context, step.id, null);
    expect(reset.parameterEdits).toEqual([]);
    expect(reset.fingerprint).toBe(plan.fingerprint);
    expect(stepOf(reset, POSTS).parametersEdited).toBeUndefined();
  });

  it("sends an edited path parameter as its value, no longer needing an environment value", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf(plan, POST);
    expect(step.requiredValues.length).toBeGreaterThan(1);
    const edited = save(plan, context, step.id, [{ location: "path", name: "postId", action: "set", value: "42" }]);
    expect(sentUrl(edited, context, step.id)).toBe("{{baseUrl}}/api/v1/posts/42");
    expect(stepOf(edited, POST).requiredValues).toEqual(["baseUrl"]);
  });

  it("lists a {{name}} the engineer wrote as a parameter-reference value, secret in a password parameter", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf(plan, POSTS);
    const edited = save(plan, context, step.id, [
      { location: "header", name: "X-Signing-Key", action: "set", value: "{{signingKey}}" },
      { location: "query", name: "userId", action: "set", value: "{{loadUserId}}" },
    ]);
    const values = new Map(edited.userSuppliedValues.map((value) => [value.name, value]));
    expect(values.get("signingKey")).toMatchObject({ source: "parameter-reference", secret: true });
    expect(values.get("loadUserId")).toMatchObject({ source: "parameter-reference", secret: false });
    expect(Object.keys(JSON.parse(renderScript(edited, context).environmentTemplate))).toEqual(expect.arrayContaining(["signingKey", "loadUserId"]));
    expect(renderScript(edited, context).script).not.toContain("tenant-secret");
  });

  it("refuses each change that cannot be saved, naming the parameter and never quoting the value", async () => {
    const { context, plan, stepOf } = await setup();
    const posts = stepOf(plan, POSTS).id;
    const post = stepOf(plan, POST).id;
    const tryEdit = (stepId: string, parameters: ParameterEditEntry[]) => refusal(() => validateParameterEdits(plan, context, { [stepId]: { parameters } }));

    expect(tryEdit(posts, [{ location: "header", name: "X-Tenant", action: "omit" }])).toMatchObject({ code: "parameter_required", extra: { location: "header", name: "X-Tenant" } });
    expect(tryEdit(post, [{ location: "path", name: "postId", action: "set", value: " " }]).code).toBe("parameter_required");
    expect(tryEdit(posts, [{ location: "query", name: "tags", action: "set", value: "a" }]).code).toBe("parameter_not_editable");
    expect(tryEdit(posts, [{ location: "query", name: "unknown", action: "set", value: "a" }]).code).toBe("invalid_parameter_edit");
    expect(tryEdit(posts, [{ location: "query", name: "sort", action: "set", value: "a\r\nX-Injected: 1" }]).code).toBe("invalid_parameter_edit");
    expect(tryEdit(posts, [{ location: "query", name: "sort", action: "set", value: "x".repeat(2_049) }]).code).toBe("parameter_too_long");
    expect(tryEdit(posts, [{ location: "query", name: "sort", action: "set", value: "{{apipilot_unique_0}}" }])).toMatchObject({ code: "reserved_reference", extra: { reference: "apipilot_unique_0" } });
    const secret = tryEdit(posts, [{ location: "header", name: "X-Signing-Key", action: "set", value: "tenant-secret" }]);
    expect(secret.code).toBe("parameter_secret_literal");
    expect(secret.message).not.toContain("tenant-secret");
    expect(
      tryEdit(posts, [
        { location: "query", name: "sort", action: "set", value: "newest" },
        { location: "query", name: "sort", action: "omit" },
      ]).code,
    ).toBe("invalid_parameter_edit");
    expect(refusal(() => validateParameterEdits(plan, context, { "s-missing": { parameters: [] } })).code).toBe("invalid_parameter_edit");
    // An array parameter can still be left out.
    expect(validateParameterEdits(plan, context, { [posts]: { parameters: [{ location: "query", name: "tags", action: "omit" }] } })).toBeDefined();
  });

  it("refuses a malformed request as invalid_request, and applies nothing when one step fails", async () => {
    const { context, plan, stepOf } = await setup();
    const posts = stepOf(plan, POSTS).id;
    const post = stepOf(plan, POST).id;
    expect(() => validateParameterEdits(plan, context, [])).toThrow(InvalidPlanUpdateError);
    expect(() => validateParameterEdits(plan, context, { [posts]: { parameters: [{ location: "cookie", name: "a", action: "omit" }] } })).toThrow(InvalidPlanUpdateError);
    expect(() =>
      applyPlanUpdate(
        plan,
        {
          parameterEdits: {
            [posts]: { parameters: [{ location: "query", name: "sort", action: "set", value: "newest" }] },
            [post]: { parameters: [{ location: "path", name: "postId", action: "omit" }] },
          },
        },
        context,
      ),
    ).toThrow(InvalidParameterEditError);
  });

  it("never mutates the scenario it edits", async () => {
    const { context, plan, stepOf } = await setup();
    const step = stepOf(plan, POSTS);
    const scenario = context.approvedScenarios.find((candidate) => candidate.id === step.scenarioId)!;
    const before = structuredClone(scenario);
    applyParameterEdit(scenario, { stepId: step.id, operationKey: POSTS, scenarioId: scenario.id, parameters: [{ location: "query", name: "limit", action: "omit" }] });
    expect(scenario).toEqual(before);
  });
});

describe("parameters a workflow variable fills", () => {
  it("are shown as filled at run time and cannot be edited", async () => {
    const context = await performanceContext();
    const plan = buildPlan(context);
    const step = plan.journeys
      .flatMap((journey) => journey.steps)
      .find((candidate) => candidate.variableBindings.some((binding) => binding.role === "consumes" && binding.location === "path"))!;
    expect(step).toBeDefined();
    const binding = step.variableBindings.find((candidate) => candidate.role === "consumes" && candidate.location === "path")!;
    const row = buildStepRequestPreview(plan, context, step.id).parameterEdit!.rows.find((candidate) => candidate.name === binding.field)!;
    expect(row.notEditable).toBe("filled-at-run-time");
    expect(refusal(() => validateParameterEdits(plan, context, { [step.id]: { parameters: [{ location: "path", name: binding.field, action: "set", value: "1" }] } })).code).toBe(
      "parameter_not_editable",
    );
  });
});

describe("parameter edits across plan changes and runs", () => {
  async function editedPosts() {
    const { context, plan, stepOf } = await setup();
    const step = stepOf(plan, POSTS);
    const edited = save(plan, context, step.id, [{ location: "query", name: "sort", action: "set", value: "oldest" }]);
    return { context, edited, step, stepOf };
  }

  it("keeps an edit while its operation is removed, and brings it back on restore", async () => {
    const { context, edited, step, stepOf } = await editedPosts();
    const removed = applyPlanUpdate(edited, { excludedOperationKeys: [POSTS] }, context);
    expect(removed.parameterEdits).toHaveLength(1);
    const restored = applyPlanUpdate(removed, { excludedOperationKeys: [] }, context);
    expect(stepOf(restored, POSTS).parametersEdited).toBe(true);
    expect(sentUrl(restored, context, step.id)).toContain("sort=oldest");
  });

  it("discards an edit when a rebuild gives the step a different scenario, and names the operation", async () => {
    const { context, edited } = await editedPosts();
    const changed: PerformanceContext = {
      ...context,
      approvedScenarios: context.approvedScenarios.map((scenario) => (scenario.operationPath === "/api/v1/posts" ? { ...scenario, id: `${scenario.id}-revised` } : scenario)),
    };
    const rebuilt = rebuildPlan(edited, changed, { keepOrder: true });
    expect(rebuilt.parameterEdits).toEqual([]);
    expect(rebuilt.discardedParameterEdits).toEqual([POSTS]);
    expect(applyPlanUpdate(rebuilt, { thinkTimeMs: 0 }, changed).discardedParameterEdits).toEqual([]);
  });

  it("stores a run snapshot without parameter values, keeping which steps were edited", async () => {
    const { edited } = await editedPosts();
    const snapshot = planSnapshotForRun(edited);
    expect(snapshot.parameterEdits).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("oldest");
    expect(snapshot.journeys.flatMap((journey) => journey.steps).some((step) => step.parametersEdited)).toBe(true);
  });
});
