import { summarizeWriteOperations } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { ensureStableIds } from "../../../../src/externalCollections/itemIdentity";
import { parseUploadedCollection } from "../../../../src/externalCollections/uploadedCollectionParsing";
import { assembleCollectionPlan, defaultCollectionChoices, tokenKeyOf } from "../../../../src/performance/collection/assembleCollectionPlan";
import { bearerAuth, collectionOf, requestItem, testScript } from "../../../fixtures/collections/collectionBuilders";

/** AP-036 research R8, FR-027 (tasks T025). */

function assemble(collection: Record<string, unknown>, ids: string[]) {
  const json = ensureStableIds(parseUploadedCollection(JSON.stringify(collection)));
  return assembleCollectionPlan({ id: "c", name: "C", tier: "local", json }, defaultCollectionChoices(ids), { supportedDynamicVariables: new Set() });
}

const login = (setters: string[]) =>
  requestItem("login", "Login", { method: "POST", auth: { type: "noauth" }, event: [testScript("pm.response.to.have.status(200);", ...setters)] });

describe("credential requests", () => {
  it("runs a request whose values feed only later auth once before the load, and rewrites its consumers to token values", () => {
    const { plan, requests, tokenSources } = assemble(
      collectionOf([login(['pm.environment.set("token", pm.response.json().token);']), requestItem("orders", "Orders", { method: "POST" })], { auth: bearerAuth("{{token}}") }),
      ["login", "orders"],
    );
    const credential = plan.collection!.credentialRequests[0];
    expect(credential.request).toMatchObject({ itemId: "login", method: "POST" });
    expect(credential.usedBy).toEqual([{ captureName: "token", stepIds: [plan.journeys[0].steps[0].id] }]);
    const [orders] = plan.journeys[0].steps;
    expect(plan.journeys[0].steps).toHaveLength(1);
    expect(orders.auth).toEqual({ kind: "chained-login", schemeName: credential.stepId });
    expect(requests.get(orders.id)!.template.auth).toEqual({ kind: "bearer", token: `{{${tokenKeyOf(credential.stepId, "token")}}}` });
    expect(requests.get(orders.id)!.tokenSchemes).toEqual([credential.stepId]);
    expect(tokenSources).toMatchObject([{ scheme: credential.stepId, expected: ["200"], captures: [{ key: tokenKeyOf(credential.stepId, "token"), name: "token" }] }]);
    expect(summarizeWriteOperations(plan.journeys).operations.map((entry) => entry.operationKey)).toEqual(["POST /orders"]);
  });

  it("counts an Authorization header use, but keeps a login whose value also fills a path, or is never used, as a journey step", () => {
    const header = assemble(
      collectionOf([login(['pm.environment.set("token", pm.response.json().token);']), requestItem("me", "Me", { header: [{ key: "authorization", value: "Bearer {{token}}" }] })]),
      ["login", "me"],
    );
    expect(header.plan.collection!.credentialRequests).toHaveLength(1);

    const alsoId = assemble(
      collectionOf(
        [login(['pm.environment.set("token", pm.response.json().token);', 'pm.environment.set("user", pm.response.json().user);']), requestItem("me", "Me", { url: "{{baseUrl}}/users/{{user}}" })],
        { auth: bearerAuth("{{token}}") },
      ),
      ["login", "me"],
    );
    expect(alsoId.plan.collection!.credentialRequests).toEqual([]);
    expect(alsoId.plan.journeys[0].steps.map((step) => step.collectionRequest?.itemId)).toEqual(["login", "me"]);

    const unused = assemble(collectionOf([login(['pm.environment.set("token", pm.response.json().token);']), requestItem("me", "Me")]), ["login", "me"]);
    expect(unused.plan.collection!.credentialRequests).toEqual([]);
  });

  it("acquires a credential request that uses another one's value after it, and refreshes both for its consumers", () => {
    const { plan, requests } = assemble(
      collectionOf([
        login(['pm.environment.set("token", pm.response.json().token);']),
        requestItem("session", "Session", { method: "POST", auth: bearerAuth("{{token}}"), event: [testScript('pm.environment.set("session", pm.response.json().session);')] }),
        requestItem("orders", "Orders", { auth: { type: "apikey", apikey: [{ key: "key", value: "Authorization" }, { key: "value", value: "{{session}}" }, { key: "in", value: "header" }] } }),
      ]),
      ["login", "session", "orders"],
    );
    const [first, second] = plan.collection!.credentialRequests;
    expect([first.request.itemId, second.request.itemId]).toEqual(["login", "session"]);
    expect(requests.get(second.stepId)!.template.auth).toEqual({ kind: "bearer", token: `{{${tokenKeyOf(first.stepId, "token")}}}` });
    expect(requests.get(plan.journeys[0].steps[0].id)!.tokenSchemes).toEqual([first.stepId, second.stepId]);
  });

  it("keeps a candidate that uses a journey step's value as a journey step", () => {
    const { plan } = assemble(
      collectionOf([
        requestItem("tenant", "Tenant", { event: [testScript('pm.environment.set("tenant", pm.response.json().id);')] }),
        requestItem("login", "Login", { method: "POST", url: "{{baseUrl}}/t/{{tenant}}/login", event: [testScript('pm.environment.set("token", pm.response.json().token);')] }),
        requestItem("orders", "Orders", { auth: bearerAuth("{{token}}") }),
      ]),
      ["tenant", "login", "orders"],
    );
    expect(plan.collection!.credentialRequests).toEqual([]);
    expect(plan.journeys[0].steps).toHaveLength(3);
  });
});
