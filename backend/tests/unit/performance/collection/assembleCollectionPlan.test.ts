import { describe, expect, it } from "vitest";
import { ensureStableIds } from "../../../../src/externalCollections/itemIdentity";
import { parseUploadedCollection } from "../../../../src/externalCollections/uploadedCollectionParsing";
import { assembleCollectionPlan, defaultCollectionChoices, type CollectionPlanChoices } from "../../../../src/performance/collection/assembleCollectionPlan";
import { collectionJourneyIdFor, collectionStepIdFor } from "../../../../src/performance/plan/identifiers";
import { APIFOUNDRY_REQUEST_IDS, apifoundryCollection, collectionOf, requestItem, testScript } from "../../../fixtures/collections/collectionBuilders";

/** AP-036 research R13 to R15, R19, SC-005 (tasks T027). */

const json = ensureStableIds(parseUploadedCollection(JSON.stringify(apifoundryCollection({ dynamicBody: false }))));
const SOURCE = { id: "c-1", name: "APIFoundry", tier: "local" as const, json };

function assemble(choices: Partial<CollectionPlanChoices> = {}, source = SOURCE) {
  return assembleCollectionPlan(source, { ...defaultCollectionChoices([...APIFOUNDRY_REQUEST_IDS]), ...choices }, { supportedDynamicVariables: new Set() });
}

describe("assembleCollectionPlan", () => {
  it("gives content-derived ids that survive a rebuild, a reorder and a removal (R19)", () => {
    const { plan } = assemble();
    expect(plan.journeys[0].id).toBe(collectionJourneyIdFor("c-1"));
    const ids = plan.journeys[0].steps.map((step) => step.id);
    expect(ids).toEqual(APIFOUNDRY_REQUEST_IDS.slice(1).map(collectionStepIdFor));
    const reordered = assemble({ stepOrder: [...ids.slice(0, 5), ids[6], ids[5]] }).plan.journeys[0].steps.map((step) => step.id);
    expect(new Set(reordered)).toEqual(new Set(ids));
    expect(assemble({ excludedRequestIds: ["req-health"] }).plan.journeys[0].steps.map((step) => step.id)).toEqual(ids.filter((id) => id !== collectionStepIdFor("req-health")));
  });

  it("fills each step as research R15 states, and leaves the OpenAPI fields empty", () => {
    const { plan } = assemble();
    const create = plan.journeys[0].steps[1];
    expect(create).toMatchObject({
      operationKey: "POST /api/v1/customers",
      method: "POST",
      path: "/api/v1/customers",
      scenarioId: "collection:req-create-customer",
      scenarioDescription: "Create customer",
      scenarioChoice: "collection-request",
      collectionRequest: { itemId: "req-create-customer", name: "Create customer", folderPath: ["Customers"] },
      variableBindings: [],
      dependency: null,
    });
    expect(plan.excludedOperationKeys).toEqual([]);
    expect(plan.omitted).toEqual([]);
    expect(plan.uniqueValueFields).toEqual([]);
    expect(plan.source).toBe("collection");
  });

  it("is a pure function of the collection and choices", () => {
    expect(assemble().plan).toEqual(assemble().plan);
  });

  it("resets the review when the conversion changes, and keeps it when only settings change (R14)", () => {
    const reviewed = assemble().plan.collection!.review.conversionDigest;
    const settings = assemble({ reviewedConversionDigest: reviewed, thinkTimeMs: 300, expectedStatusCodes: new Map([[collectionStepIdFor("req-health"), ["2XX"]]]) });
    expect(settings.plan.collection!.review).toEqual({ reviewed: true, conversionDigest: reviewed });
    const removed = assemble({ reviewedConversionDigest: reviewed, excludedRequestIds: ["req-create-customer"] });
    expect(removed.plan.collection!.review.reviewed).toBe(false);
  });

  it("orders findings by step, then owner, then line", () => {
    const collection = collectionOf(
      [
        requestItem("a", "A", { event: [testScript("console.log(1);", "", "pm.setNextRequest(null);")] }),
        requestItem("b", "B", { event: [testScript("x = 1;")] }),
      ],
      { event: [testScript("console.log('collection');")] },
    );
    const source = { id: "c-2", name: "C", tier: "local" as const, json: ensureStableIds(parseUploadedCollection(JSON.stringify(collection))) };
    const { plan } = assembleCollectionPlan(source, defaultCollectionChoices(["b", "a"]), { supportedDynamicVariables: new Set() });
    expect(plan.collection!.findings.map((finding) => [finding.owner.kind, finding.owner.kind === "request" ? finding.owner.itemId : "", finding.line])).toEqual([
      ["collection", "", 1],
      ["request", "b", 1],
      ["request", "a", 1],
      ["request", "a", 3],
    ]);
  });

  it("builds a plan without steps when every selected request is left out", () => {
    const collection = collectionOf([requestItem("a", "A", { auth: { type: "digest", digest: [] } })]);
    const source = { id: "c-3", name: "C", tier: "local" as const, json: ensureStableIds(parseUploadedCollection(JSON.stringify(collection))) };
    const { plan } = assembleCollectionPlan(source, defaultCollectionChoices(["a"]), { supportedDynamicVariables: new Set() });
    expect(plan.journeys).toEqual([]);
    expect(plan.collection!.leftOut.map((request) => request.reason)).toEqual(["unsupported-auth"]);
  });

  it("builds a plan from a 100-request collection in under 5 seconds (SC-005)", () => {
    const items = Array.from({ length: 100 }, (_unused, index) =>
      requestItem(`r${index}`, `Request ${index}`, {
        method: index % 2 === 0 ? "POST" : "GET",
        url: `{{baseUrl}}/items/{{id_${index - 1}}}`,
        event: [testScript(`pm.test("ok", () => pm.response.to.have.status(200));`, `const body = pm.response.json();`, `pm.environment.set("id_${index}", body.data.items[0].id);`, `console.log(${index});`)],
      }),
    );
    const source = { id: "c-big", name: "Big", tier: "local" as const, json: ensureStableIds(parseUploadedCollection(JSON.stringify(collectionOf(items)))) };
    const started = performance.now();
    const { plan } = assembleCollectionPlan(source, defaultCollectionChoices(items.map((item) => item.id)), { supportedDynamicVariables: new Set() });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(plan.journeys[0].steps).toHaveLength(100);
    expect(plan.journeys[0].steps[99].bindings?.[0].captureName).toBe("id_98");
  });
});
