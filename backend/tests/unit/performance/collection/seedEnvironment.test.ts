import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getEnvironment } from "../../../../src/execution/environmentStore";
import { assembleCollectionPlan, defaultCollectionChoices } from "../../../../src/performance/collection/assembleCollectionPlan";
import { seedEnvironmentFromCollection } from "../../../../src/performance/collection/seedEnvironment";
import { BaseUrlMissingError } from "../../../../src/performance/errors";
import { enterTestSession } from "../../../../src/session/sessionContext";
import { bearerAuth, collectionOf, requestItem } from "../../../fixtures/collections/collectionBuilders";
import { storeCollection } from "../../../fixtures/performance/collectionPlans";

/** AP-036 FR-017 (research R17; tasks T062). */

const SEEDED_LITERAL = "SEEDED-LITERAL-91aa";

const COLLECTION = collectionOf(
  [
    requestItem("token", "Token", { method: "POST", url: "{{host}}/token", header: [{ key: "X-API-Key", value: SEEDED_LITERAL }] }),
    requestItem("items", "Items", { url: "{{host}}/items?client={{client_id}}&region={{region}}&missing={{nowhere}}" }),
  ],
  { auth: bearerAuth("{{token}}"), variable: [{ key: "region", value: "eu" }, { key: "client_id", value: "default-client" }, { key: "host", value: "http://default.example" }] },
);

function seed(variableValues: Record<string, string>, name = "perf") {
  const stored = storeCollection(COLLECTION, { tier: "staging", variableValues });
  const assembly = assembleCollectionPlan({ id: stored.id, name: stored.name, tier: stored.tier, json: stored.collection }, defaultCollectionChoices(["token", "items"]), { supportedDynamicVariables: new Set() });
  return { environment: seedEnvironmentFromCollection(name, stored, stored.collection, assembly), assembly, stored };
}

describe("seedEnvironmentFromCollection", () => {
  beforeEach(() => enterTestSession(randomUUID()));

  it("copies the base URL, the values the plan needs by the collection's precedence, and the literals, with the collection's tier", () => {
    const { environment, assembly } = seed({ host: "http://127.0.0.1:4600", client_id: "env-client", token: "env-token", unrelated: "x" });
    const literal = assembly.plan.userSuppliedValues.find((value) => value.source === "collection-literal")!.name;
    expect(environment).toMatchObject({ name: "perf", tier: "staging", baseUrl: "http://127.0.0.1:4600", requestDelayMs: 0 });
    expect(environment.variableValues).toEqual({ client_id: "env-client", region: "eu", token: "env-token", [literal]: SEEDED_LITERAL });
    expect(getEnvironment(environment.id).variableValues).toEqual(environment.variableValues);
  });

  it("leaves out names that resolve to nothing, and falls back to the collection's default", () => {
    const { environment } = seed({ client_id: "" }, "defaults");
    expect(environment.baseUrl).toBe("http://default.example");
    expect(environment.variableValues.client_id).toBe("default-client");
    expect(environment.variableValues).not.toHaveProperty("nowhere");
    expect(environment.variableValues).not.toHaveProperty("token");
  });

  it("refuses when the base-URL variable has no value", () => {
    const stored = storeCollection(collectionOf([requestItem("a", "A", { url: "{{base}}/a" })]), { variableValues: {} });
    const assembly = assembleCollectionPlan({ id: stored.id, name: stored.name, tier: stored.tier, json: stored.collection }, defaultCollectionChoices(["a"]), { supportedDynamicVariables: new Set() });
    expect(() => seedEnvironmentFromCollection("none", stored, stored.collection, assembly)).toThrow(BaseUrlMissingError);
  });

  it("does not change the collection", () => {
    const { stored } = seed({ host: "http://127.0.0.1:4600" }, "unchanged");
    expect(JSON.parse(stored.collection)).toMatchObject({ item: [{ id: "token" }, { id: "items" }] });
    expect(stored.variableValues).toEqual({ host: "http://127.0.0.1:4600" });
  });
});
