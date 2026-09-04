import { describe, expect, it } from "vitest";
import {
  analysisRequestId,
  relationshipId,
  workflowId,
} from "../../../src/dependencies/identifiers";
import { crudChainApiModel } from "../../fixtures/dependencies/dependencyFixtures";

const producer = { operationPath: "/users", operationMethod: "POST", field: "id" };
const consumer = {
  operationPath: "/users/{userId}",
  operationMethod: "GET",
  field: "userId",
  location: "path" as const,
};

describe("relationshipId", () => {
  it("is a pure function of the producer/consumer field-ref tuple", () => {
    const first = relationshipId(producer, consumer);
    const second = relationshipId(producer, consumer);
    expect(first).toBe(second);
  });

  it("changes when any part of the tuple changes", () => {
    const baseline = relationshipId(producer, consumer);
    expect(relationshipId({ ...producer, field: "otherId" }, consumer)).not.toBe(baseline);
    expect(relationshipId(producer, { ...consumer, field: "otherId" })).not.toBe(baseline);
    expect(relationshipId(producer, { ...consumer, location: "query" })).not.toBe(baseline);
    expect(relationshipId(producer, { ...consumer, operationMethod: "PUT" })).not.toBe(baseline);
  });

  it("does not change between two calls in the same process", () => {
    const ids = Array.from({ length: 5 }, () => relationshipId(producer, consumer));
    expect(new Set(ids).size).toBe(1);
  });
});

describe("workflowId", () => {
  it("is a pure function of the ordered relationship id list", () => {
    const ids = ["rel-a", "rel-b", "rel-c"];
    expect(workflowId(ids)).toBe(workflowId([...ids]));
  });

  it("changes when the order changes", () => {
    expect(workflowId(["rel-a", "rel-b"])).not.toBe(workflowId(["rel-b", "rel-a"]));
  });

  it("changes when the relationship id set changes", () => {
    expect(workflowId(["rel-a", "rel-b"])).not.toBe(workflowId(["rel-a", "rel-c"]));
  });
});

describe("analysisRequestId", () => {
  it("is a pure function of the ApiModel", () => {
    expect(analysisRequestId(crudChainApiModel)).toBe(analysisRequestId(crudChainApiModel));
  });

  it("changes when the ApiModel's operations change", () => {
    const mutated = { ...crudChainApiModel, operations: crudChainApiModel.operations.slice(1) };
    expect(analysisRequestId(mutated)).not.toBe(analysisRequestId(crudChainApiModel));
  });
});
