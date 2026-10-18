import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiDependencyRelationship, ApiModel, DependencyHint } from "@apipilot/shared-domain";
import { loadDefinition } from "../../../src/apiInput/definition/loadDefinition";
import { buildHarModel } from "../../../src/apiInput/har/buildHarModel";
import { DEFAULT_INPUT_LIMITS } from "../../../src/apiInput/limits";
import { analyzeDependencies } from "../../../src/dependencies/analyzeDependencies";
import { confidenceOfHint, mergeInputHints } from "../../../src/dependencies/mergeRelationships";
import { harOf, jsonEntry } from "../../fixtures/apiInput/harBuilders";

const API = "https://api.shop.test";

const observedHint = (matchCount: number, overrides: Partial<DependencyHint> = {}): DependencyHint => ({
  origin: "observed",
  producer: { operationMethod: "POST", operationPath: "/v1/batches", field: "batchRef" },
  consumer: { operationMethod: "GET", operationPath: "/v1/reports", field: "ref", location: "query" },
  matchCount,
  orderObserved: true,
  ...overrides,
});

describe("confidenceOfHint (FR-038, research R20)", () => {
  it("rates observed value reuse POSSIBLE for one consuming request and LIKELY for two or more, never CONFIRMED", () => {
    expect(confidenceOfHint(observedHint(1))).toBe("POSSIBLE");
    expect(confidenceOfHint(observedHint(2))).toBe("LIKELY");
    expect(confidenceOfHint(observedHint(500))).toBe("LIKELY");
    expect(confidenceOfHint(observedHint(undefined as unknown as number))).toBe("POSSIBLE");
  });

  it("rates a declared hint CONFIRMED only when its fields were verified against declared schemas", () => {
    expect(confidenceOfHint({ ...observedHint(1), origin: "declared", verified: true })).toBe("CONFIRMED");
    expect(confidenceOfHint({ ...observedHint(1), origin: "declared", verified: false })).toBe("LIKELY");
    expect(confidenceOfHint({ ...observedHint(1), origin: "declared" })).toBe("LIKELY");
  });
});

describe("mergeInputHints", () => {
  it("returns the deterministic relationships untouched when there are no hints", () => {
    const deterministic: ApiDependencyRelationship[] = [];
    expect(mergeInputHints(deterministic, [])).toBe(deterministic);
  });

  it("adds a hint as its own relationship with the hint as evidence and a stable id", () => {
    const [relationship] = mergeInputHints([], [observedHint(2)]);
    expect(relationship).toMatchObject({
      source: "observed",
      confidence: "LIKELY",
      producer: { operationMethod: "POST", operationPath: "/v1/batches", field: "batchRef" },
      consumer: { operationMethod: "GET", operationPath: "/v1/reports", field: "ref", location: "query" },
      inputEvidence: { origin: "observed", matchCount: 2 },
    });
    expect(relationship.explanation).toContain("Observed in the capture");
    expect(relationship.explanation).toContain("not proof");
    expect(mergeInputHints([], [observedHint(2)])[0].id).toBe(relationship.id);
  });

  it("describes a declared hint as declared and says whether the fields were checked", () => {
    const [verified] = mergeInputHints([], [{ ...observedHint(1), origin: "declared", verified: true }]);
    expect(verified).toMatchObject({ source: "declared", confidence: "CONFIRMED" });
    expect(verified.explanation).toContain("Declared in the API definition");
    expect(verified.explanation).toContain("Both fields exist in the declared schemas");
    const [unchecked] = mergeInputHints([], [{ ...observedHint(1), origin: "declared", verified: false }]);
    expect(unchecked.explanation).toContain("could not be checked");
  });

  it("merges with a deterministic finding for the same fields: it stays deterministic and keeps the better confidence", () => {
    const deterministic: ApiDependencyRelationship = {
      id: "d1",
      producer: { operationPath: "/v1/batches", operationMethod: "POST", field: "batchRef" },
      consumer: { operationPath: "/v1/reports", operationMethod: "GET", field: "ref", location: "query" },
      confidence: "CONFIRMED",
      source: "deterministic",
      explanation: "matching field name, matching data type",
    };
    const [merged] = mergeInputHints([deterministic], [observedHint(1)]);
    expect(merged).toMatchObject({ id: "d1", source: "deterministic", confidence: "CONFIRMED", inputEvidence: { matchCount: 1 } });
    expect(merged.explanation).toContain("matching field name, matching data type");
    expect(merged.explanation).toContain("Observed in the capture");
    const weaker: ApiDependencyRelationship = { ...deterministic, confidence: "POSSIBLE" };
    expect(mergeInputHints([weaker], [observedHint(3)])[0].confidence).toBe("LIKELY");
    const stronger = mergeInputHints([{ ...deterministic, confidence: "LIKELY" }], [observedHint(1)]);
    expect(stronger[0].confidence).toBe("LIKELY");
  });
});

describe("analyzeDependencies with a HAR-derived model", () => {
  async function model(): Promise<ApiModel> {
    return buildHarModel(
      harOf([
        jsonEntry("POST", `${API}/v1/batches`, 201, { batchRef: "BATCH-2026-000417" }, { name: "n1" }),
        jsonEntry("GET", `${API}/v1/reports?ref=BATCH-2026-000417`, 200, { rows: 3 }),
        jsonEntry("POST", `${API}/v1/orders`, 201, { id: "ord_7f3a9c21d4" }, { sku: "A" }),
        jsonEntry("POST", `${API}/v1/orders`, 201, { id: "ord_1b2c3d4e5f60" }, { sku: "B" }),
        jsonEntry("GET", `${API}/v1/orders/ord_7f3a9c21d4`, 200, { total: 1 }),
        jsonEntry("GET", `${API}/v1/orders/ord_1b2c3d4e5f60`, 200, { total: 2 }),
      ]),
      DEFAULT_INPUT_LIMITS,
    );
  }

  it("turns a single observed reuse into a POSSIBLE relationship that needs manual confirmation, never a workflow", async () => {
    const result = await analyzeDependencies(await model());
    const batches = result.graph.relationships.find((r) => r.producer.operationPath === "/v1/batches" && r.consumer.operationPath === "/v1/reports");
    expect(batches).toMatchObject({ source: "observed", confidence: "POSSIBLE", inputEvidence: { origin: "observed", matchCount: 1 } });
    expect(result.manualConfirmationCandidates.some((candidate) => candidate.relationshipId === batches?.id)).toBe(true);
    expect(result.workflows.flatMap((workflow) => workflow.relationshipIds)).not.toContain(batches?.id);
  });

  it("never rates a relationship CONFIRMED on value reuse alone", async () => {
    const result = await analyzeDependencies(await model());
    for (const relationship of result.graph.relationships.filter((r) => r.source === "observed")) {
      expect(relationship.confidence).not.toBe("CONFIRMED");
    }
  });

  it("lets an existing confirming signal still confirm a pair the capture also shows", async () => {
    const result = await analyzeDependencies(await model());
    const orders = result.graph.relationships.find(
      (r) => r.producer.operationPath === "/v1/orders" && r.producer.field === "id" && r.consumer.operationPath === "/v1/orders/{orderId}",
    );
    expect(orders).toBeDefined();
    expect(orders?.source).toBe("deterministic");
    expect(orders?.confidence).toBe("CONFIRMED");
    expect(orders?.inputEvidence).toMatchObject({ origin: "observed", matchCount: 2 });
  });

  it("is deterministic", async () => {
    const first = await analyzeDependencies(await model());
    const second = await analyzeDependencies(await model());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("analyzeDependencies with a definition-derived model (specs/056 US6, research R20)", () => {
  const definitionPath = path.resolve(__dirname, "../../fixtures/apiInput/definitions/valid.json");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the helper edits deliberately invalid JSON documents, whose shape is the point of the test
  const definitionModel = (change: (document: any) => void = () => undefined): ApiModel => {
    const document = JSON.parse(readFileSync(definitionPath, "utf-8"));
    change(document);
    return loadDefinition(document);
  };
  const relationshipOf = (result: Awaited<ReturnType<typeof analyzeDependencies>>) =>
    result.graph.relationships.find(
      (r) => r.producer.operationPath === "/orders" && r.producer.field === "id" && r.consumer.operationPath === "/orders/{orderId}" && r.consumer.field === "orderId",
    );

  it("rates a declared hint whose fields exist in the declared schemas CONFIRMED, with the hint as evidence", async () => {
    const relationship = relationshipOf(await analyzeDependencies(definitionModel()));
    expect(relationship?.confidence).toBe("CONFIRMED");
    expect(relationship?.inputEvidence).toMatchObject({ origin: "declared", verified: true });
  });

  it("rates a declared hint LIKELY, stating why, when a side declares no schema", async () => {
    const model = definitionModel((d) => { delete d.operations[1].parameters[0].schema; });
    const relationship = relationshipOf(await analyzeDependencies(model));
    expect(model.dependencyHints?.[0].verified).toBe(false);
    expect(relationship?.inputEvidence).toMatchObject({ origin: "declared", verified: false });
    expect(relationship?.explanation).toContain("could not be checked");
    expect(["LIKELY", "CONFIRMED"]).toContain(relationship?.confidence);
  });

  it("finds nothing declared when the definition has no hint", async () => {
    const model = definitionModel((d) => { delete d.dependencyHints; });
    const relationship = relationshipOf(await analyzeDependencies(model));
    expect(relationship?.inputEvidence).toBeUndefined();
  });

  it("is deterministic", async () => {
    expect(JSON.stringify(await analyzeDependencies(definitionModel()))).toBe(JSON.stringify(await analyzeDependencies(definitionModel())));
  });
});
