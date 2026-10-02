import { describe, expect, it } from "vitest";
import { defaultCollectionChoices, type CollectionPlanChoices } from "../../../../src/performance/collection/assembleCollectionPlan";
import { applyCollectionUpdate, assembleFor, type CollectionEngineState } from "../../../../src/performance/collection/collectionEngine";
import { UserJourneyRefusedError } from "../../../../src/performance/errors";
import { collectionStepIdFor } from "../../../../src/performance/plan/identifiers";
import { captureKeyOf } from "../../../../src/performance/plan/stepRequest";
import { collectionOf, requestItem, testScript } from "../../../fixtures/collections/collectionBuilders";

/** AP-036 FR-019 (data-model validation rules; tasks T056). */

const COLLECTION = collectionOf([
  requestItem("create", "Create", { method: "POST", event: [testScript('pm.environment.set("id", pm.response.json().id);')] }),
  requestItem("read", "Read", { url: "{{baseUrl}}/items/{{id}}?v={{version}}", event: [testScript("if (true) { pm.environment.set(\"etag\", pm.response.headers.get(\"ETag\")); }")] }),
  requestItem("update", "Update", { method: "PUT", url: "{{baseUrl}}/items/{{id}}", header: [{ key: "If-Match", value: "{{etag}}" }] }),
]);
const SOURCE = { id: "c", name: "C", tier: "local" as const, json: JSON.stringify(COLLECTION) };
const [CREATE, READ, UPDATE] = ["create", "read", "update"].map(collectionStepIdFor);

function state(choices: Partial<CollectionPlanChoices> = {}): CollectionEngineState {
  return { source: SOURCE, choices: { ...defaultCollectionChoices(["create", "read", "update"]), ...choices }, state: "current" };
}

function update(current: CollectionEngineState, body: unknown) {
  const plan = assembleFor(current.source, current.choices).plan;
  const choices = applyCollectionUpdate(current, plan, body);
  return { choices, assembly: assembleFor(current.source, choices) };
}

function refusal(run: () => unknown): { code: string; extra: unknown } {
  try {
    run();
  } catch (error) {
    if (error instanceof UserJourneyRefusedError) return { code: error.code, extra: error.extra };
    throw error;
  }
  throw new Error("Expected a refusal.");
}

describe("captures and bindings the engineer adds", () => {
  it("adds a header capture labelled as set by the engineer, which later references then bind to", () => {
    const { assembly } = update(state(), { addedCaptures: { [READ]: [{ name: "etag", source: { kind: "header", name: "ETag" } }] } });
    const read = assembly.requests.get(READ)!.step;
    expect(read.captures?.find((capture) => capture.name === "etag")).toEqual({ name: "etag", source: { kind: "header", name: "etag" }, documented: null, origin: { kind: "user" } });
    const updateStep = assembly.requests.get(UPDATE)!;
    expect(updateStep.step.bindings?.find((binding) => binding.captureName === "etag")?.captureStepId).toBe(READ);
    expect(updateStep.template.headers).toEqual([{ key: "If-Match", value: `{{${captureKeyOf(READ, "etag")}}}` }]);
    expect(assembly.plan.userSuppliedValues.map((value) => value.name)).not.toContain("etag");
  });

  it("accepts a typed body path, labelled not documented", () => {
    const { assembly } = update(state(), { addedCaptures: { [CREATE]: [{ name: "version", source: { kind: "body", path: "meta.version" } }] } });
    expect(assembly.requests.get(CREATE)!.step.captures?.find((capture) => capture.name === "version")).toMatchObject({ documented: false, origin: { kind: "user" } });
    expect(assembly.requests.get(READ)!.step.bindings?.some((binding) => binding.captureName === "version")).toBe(true);
  });

  it("refuses invalid names, paths, headers, duplicates and more than ten, leaving the choices unchanged", () => {
    const current = state();
    const tooMany = Array.from({ length: 11 }, (_unused, index) => ({ name: `c${index}`, source: { kind: "body", path: "a" } }));
    expect(refusal(() => update(current, { addedCaptures: { [READ]: [{ name: "1bad", source: { kind: "body", path: "a" } }] } })).code).toBe("capture_name_invalid");
    expect(refusal(() => update(current, { addedCaptures: { [READ]: [{ name: "ok", source: { kind: "body", path: "a[*]" } }] } })).code).toBe("capture_path_invalid");
    expect(refusal(() => update(current, { addedCaptures: { [READ]: [{ name: "ok", source: { kind: "header", name: "bad header" } }] } })).code).toBe("capture_header_invalid");
    expect(refusal(() => update(current, { addedCaptures: { [CREATE]: [{ name: "id", source: { kind: "body", path: "a" } }] } })).code).toBe("capture_name_taken");
    expect(refusal(() => update(current, { addedCaptures: { [READ]: tooMany } })).code).toBe("too_many_captures");
    expect(current.choices.addedCaptures.size).toBe(0);
  });

  it("binds a reference to an earlier capture by the engineer's choice, and refuses a later or missing one", () => {
    const { assembly } = update(state(), { addedBindings: { [READ]: [{ name: "version", captureStepId: CREATE, captureName: "id" }] } });
    expect(assembly.requests.get(READ)!.step.bindings?.find((binding) => binding.target.kind === "reference" && binding.target.name === "version")?.captureName).toBe("id");
    expect(assembly.plan.collection!.addedBindings).toEqual([{ stepId: READ, name: "version", captureStepId: CREATE, captureName: "id" }]);
    expect(refusal(() => update(state(), { addedBindings: { [CREATE]: [{ name: "id", captureStepId: READ, captureName: "etag" }] } })).code).toBe("binding_target_unknown");
    expect(refusal(() => update(state(), { addedBindings: { [READ]: [{ name: "version", captureStepId: UPDATE, captureName: "id" }] } })).code).toBe("binding_capture_unknown");
    expect(refusal(() => update(state(), { addedBindings: { [READ]: [{ name: "version", captureStepId: CREATE, captureName: "nope" }] } })).code).toBe("binding_capture_unknown");
  });

  it("refuses removing an added capture an added binding still uses", () => {
    const withCapture = update(state(), { addedCaptures: { [READ]: [{ name: "etag", source: { kind: "header", name: "ETag" } }] } }).choices;
    const bound = update(state(withCapture), { addedBindings: { [UPDATE]: [{ name: "etag", captureStepId: READ, captureName: "etag" }] } }).choices;
    expect(refusal(() => update(state(bound), { addedCaptures: { [READ]: [] } })).code).toBe("capture_in_use");
  });

  it("does not change the conversion digest for the engineer's own captures", () => {
    const before = assembleFor(SOURCE, state().choices).plan.collection!.review.conversionDigest;
    const { assembly } = update(state(), { addedCaptures: { [CREATE]: [{ name: "version", source: { kind: "body", path: "v" } }] } });
    expect(assembly.plan.collection!.review.conversionDigest).toBe(before);
  });
});
