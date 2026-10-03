import { describe, expect, it } from "vitest";
import { analyzeChainPlan } from "@apipilot/shared-domain";
import { parseStoredCollection } from "../../../../../src/externalCollections/uploadedCollectionParsing";
import { assembleSeededPlan } from "../../../../../src/performance/chain/seed/assembleSeededPlan";
import { seedFromCollection } from "../../../../../src/performance/chain/seed/seedFromCollection";
import { APIFOUNDRY_REQUEST_IDS, apifoundryCollection } from "../../../../fixtures/collections/collectionBuilders";
import { TWO_FOLDER_REQUEST_IDS, twoFolderCollection } from "../../../../fixtures/chain/collections";

/** AP-037 (specs/037-request-chain-performance tasks T066; US4, FR-024, FR-025; research R17). */

const NOW = "2026-10-03T12:00:00.000Z";
const STORED = { id: "col-1", name: "Two folders" };

function seed(raw: Record<string, unknown>, ids: readonly string[], environment: { name: string; valueNames: string[] } | null = null) {
  return assembleSeededPlan({ ...seedFromCollection(STORED, parseStoredCollection(JSON.stringify(raw)), ids, "Seeded", NOW), environment });
}

describe("seedFromCollection", () => {
  it("gives one chain per top-level folder in run order, with extractors, statuses and inherited auth as a header", () => {
    const { plan } = seed(twoFolderCollection(), TWO_FOLDER_REQUEST_IDS);
    expect(plan.chains.map((chain) => [chain.name, chain.steps.map((step) => step.name)])).toEqual([
      ["Auth", ["Get token"]],
      ["Customers", ["Create customer", "Get customer"]],
    ]);
    const [token] = plan.chains[0].steps;
    const [create, get] = plan.chains[1].steps;
    expect(token).toMatchObject({ runs: "once-before-load", extractors: [{ name: "token", source: { kind: "body", path: "access_token" } }], body: { kind: "form", fields: [{ name: "client_id", value: "{{client_id}}" }] } });
    expect(create).toMatchObject({ runs: "every-iteration", expectedStatuses: ["201"], extractors: [{ name: "customer_id", source: { kind: "body", path: "id" } }] });
    expect(create.body).toEqual({ kind: "raw", contentType: "application/json", text: '{"name":"{{$randomFullName}}"}' });
    expect(create.headers).toEqual([{ name: "Authorization", value: "Bearer {{token}}" }]);
    expect(get.url).toBe("{{baseUrl}}/api/v1/customers/{{customer_id}}");
    expect(get.source).toEqual({ kind: "collection", collectionId: "col-1", collectionName: "Two folders", itemId: "req-get", label: "Customers / Get customer" });
    expect(analyzeChainPlan(plan, { environmentValueNames: null }).blockers).toEqual([{ kind: "missing-expected-status", stepId: token.id }, { kind: "missing-expected-status", stepId: get.id }]);
  });

  it("lists the pre-request script and the statements it did not carry over, each with its source", () => {
    const { plan } = seed(twoFolderCollection(), TWO_FOLDER_REQUEST_IDS);
    const items = plan.seedingReport!.items;
    expect(items).toContainEqual(expect.objectContaining({ kind: "pre-request-script", sourceLabel: "Customers / Create customer" }));
    expect(items.some((item) => item.kind === "unrecognised-statement" && item.sourceLabel === "Customers / Create customer" && /line 3/.test(item.detail))).toBe(true);
    expect(plan.seedingReport!.source).toEqual({ kind: "collection", collectionId: "col-1", collectionName: "Two folders" });
  });

  it("seeds the APIFoundry collection deterministically, with its credential request once before load", () => {
    const first = seed(apifoundryCollection({ dynamicBody: true }), APIFOUNDRY_REQUEST_IDS).plan;
    const second = seed(apifoundryCollection({ dynamicBody: true }), APIFOUNDRY_REQUEST_IDS).plan;
    expect(second.chains).toEqual(first.chains);
    expect(second.seedingReport).toEqual(first.seedingReport);
    const steps = first.chains.flatMap((chain) => chain.steps);
    expect(steps.filter((step) => step.runs === "once-before-load").map((step) => step.name)).toEqual(["Get token"]);
    expect(steps.every((step) => step.source.kind === "collection" && step.changed === false)).toBe(true);
  });

  it("never runs a script: the seed reads text only", () => {
    const raw = twoFolderCollection();
    const before = JSON.stringify(raw);
    seed(raw, TWO_FOLDER_REQUEST_IDS);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
