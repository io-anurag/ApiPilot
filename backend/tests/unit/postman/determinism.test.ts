import { describe, expect, it } from "vitest";
import type { ExportResult } from "@apipilot/shared-domain";
import { generateCollection } from "../../../src/postman/generateCollection";
import { serializeArtifact } from "../../../src/postman/ordering";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";

const options = { baseUrl: "https://qa.internal.example", variableValues: { token: "t-1" } };

function exportResult(testModel = approvedTestModel): ExportResult {
  const outcome = generateCollection(exportApiModel, testModel, options);
  if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
  return outcome.result;
}

function serialized(result: ExportResult): string {
  return [
    serializeArtifact(result.collection),
    serializeArtifact(result.environment),
    result.readme,
  ].join("\n");
}

describe("export determinism", () => {
  it("produces byte-identical artifacts from identical input", () => {
    expect(serialized(exportResult())).toBe(serialized(exportResult()));
  });

  it("produces the same artifacts regardless of the input scenario order", () => {
    const shuffled = { scenarios: [...approvedTestModel.scenarios].reverse() };
    expect(serialized(exportResult(shuffled))).toBe(serialized(exportResult()));
  });

  it("keeps every item id stable across repeated exports", () => {
    const first = exportResult().collection.item.flatMap((folder) => folder.item.map((i) => i.id));
    const second = exportResult().collection.item.flatMap((folder) => folder.item.map((i) => i.id));
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("emits no identifier that varies with time or randomness", () => {
    const first = exportResult().collection.info._postman_id;
    const second = exportResult().collection.info._postman_id;
    expect(second).toBe(first);
  });
});