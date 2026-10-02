import type { CollectionPerformanceTestView, PerformancePlan } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { collectionOf, prerequestScript, requestItem, testScript } from "../../fixtures/collections/collectionBuilders";
import { buildCollectionPlan, COLLECTION_BASE, collectionAgent } from "../../fixtures/performance/collectionPlans";

/** AP-036 User Story 3, quickstart 6 (FR-004, FR-007, FR-009, FR-010, FR-019; tasks T057). */

const COLLECTION = collectionOf(
  [
    requestItem("read", "Read", {
      url: "{{baseUrl}}/items/1",
      event: [
        testScript(
          'pm.test("ok", () => pm.response.to.have.status(200));',
          'if (pm.response.code === 200) { pm.environment.set("etag", pm.response.headers.get("ETag")); }',
          'pm.test("named", () => pm.expect(pm.response.json().name).to.eql("Ada"));',
        ),
      ],
    }),
    requestItem("update", "Update", { method: "PUT", url: "{{baseUrl}}/items/1", header: [{ key: "If-Match", value: "{{etag}}" }], event: [testScript("pm.response.to.have.status(200);")] }),
    requestItem("version", "Version", { url: "{{baseUrl}}/version", auth: { type: "digest", digest: [{ key: "username", value: "u" }] } }),
  ],
  { event: [prerequestScript('pm.sendRequest("https://login.example.com", (err, res) => { pm.environment.set("t", res.json().t); });')] },
);

function plan(response: { body: { collectionTest?: CollectionPerformanceTestView; plan?: PerformancePlan } }): PerformancePlan {
  return response.body.collectionTest?.plan ?? response.body.plan!;
}

describe("what was not converted, and fixing it", () => {
  it("lists each unconverted item with its owner, line and reason, leaves out Digest auth, and keeps etag an environment value", async () => {
    const { agent, collectionId } = await collectionAgent({}, { collection: COLLECTION, environment: { values: [{ key: "baseUrl", value: "http://127.0.0.1:4600", enabled: true }] } });
    const built = plan(await buildCollectionPlan(agent, collectionId, ["read", "update", "version"]));
    const [read, update] = built.journeys[0].steps;
    const findings = built.collection!.findings.map((finding) => [finding.kind, finding.owner.kind, finding.event, finding.line, finding.stepIds]);
    expect(findings).toContainEqual(["prerequest-not-converted", "collection", "prerequest", null, [read.id, update.id]]);
    expect(findings).toContainEqual(["condition", "request", "test", 2, [read.id]]);
    expect(findings).toContainEqual(["assertion-not-converted", "request", "test", 3, [read.id]]);
    expect(built.collection!.leftOut).toEqual([{ itemId: "version", name: "Version", folderPath: [], method: "GET", path: "/version", reason: "unsupported-auth", detail: "digest" }]);
    expect(update.bindings).toBeUndefined();
    expect(built.userSuppliedValues.find((value) => value.name === "etag")).toMatchObject({ source: "collection-variable", neededBySteps: [update.id] });
  });

  it("binds the later reference once the engineer adds the capture by header name", async () => {
    const { agent, collectionId } = await collectionAgent({}, { collection: COLLECTION, environment: { values: [] } });
    const [read, update] = plan(await buildCollectionPlan(agent, collectionId, ["read", "update", "version"])).journeys[0].steps;
    const added = await agent.put(`${COLLECTION_BASE}/plan`).send({ addedCaptures: { [read.id]: [{ name: "etag", source: { kind: "header", name: "ETag" } }] } });
    expect(added.status).toBe(200);
    const after = plan(added);
    expect(after.journeys[0].steps[1].bindings).toEqual([{ target: { kind: "reference", name: "etag", locations: ["header"] }, captureStepId: read.id, captureName: "etag", state: "active" }]);
    expect(after.userSuppliedValues.map((value) => value.name)).not.toContain("etag");
    const preview = (await agent.get(`${COLLECTION_BASE}/plan/steps/${update.id}/request`)).body.request;
    expect(preview.parameters.find((parameter: { name: string }) => parameter.name === "If-Match").value).toMatchObject({ kind: "capture", captureName: "etag", producerStepId: read.id });
    const reset = await agent.post(`${COLLECTION_BASE}/plan/reset`);
    expect(plan(reset).journeys[0].steps[0].captures?.some((capture) => capture.origin?.kind === "user")).toBe(true);
  });
});
