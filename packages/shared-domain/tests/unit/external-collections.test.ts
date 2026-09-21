import { describe, expect, it } from "vitest";
import type {
  CollectionView,
  PostmanRawEvent,
  PostmanRawItem,
  UploadedCollectionExecutionRun,
  UploadedCollectionSet,
  UploadedRequestResult,
  VariableBinding,
} from "../../src/externalCollections";

describe("external collection execution contracts", () => {
  it("types a minimal UploadedCollectionSet", () => {
    const uploadedCollection: UploadedCollectionSet = {
      id: "uc-1",
      name: "my-collection",
      tier: "local",
      collection: "{}",
      variableValues: { baseUrl: "https://example.test" },
      requestDelayMs: 0,
      createdAt: new Date(0).toISOString(),
    };
    expect(uploadedCollection.confirmedAt).toBeUndefined();
  });

  it("types an UploadedRequestResult with testOutcomes instead of assertionOutcomes", () => {
    const result: UploadedRequestResult = {
      requestName: "Get widget",
      requestMethod: "GET",
      outcome: "failed",
      failureCategory: "assertion-failed",
      startedAt: new Date(0).toISOString(),
      durationMs: 120,
      responseStatusCode: 500,
      testOutcomes: [{ name: "Status code is 200", outcome: "failed", detail: "expected 200, got 500" }],
    };
    expect(result.testOutcomes).toHaveLength(1);
  });

  it("types a minimal UploadedCollectionExecutionRun with source: 'uploaded'", () => {
    const run: UploadedCollectionExecutionRun = {
      id: "run-1",
      source: "uploaded",
      uploadedCollectionSetId: "uc-1",
      uploadedCollectionSnapshot: { name: "my-collection", tier: "local" },
      status: "in-progress",
      startedAt: new Date(0).toISOString(),
      summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
      results: [],
      cancelRequested: false,
    };
    expect(run.source).toBe("uploaded");
  });

  it("types a PostmanRawItem carrying a prerequest event, which postmanArtifact.ts's PostmanEvent cannot represent", () => {
    const prerequest: PostmanRawEvent = {
      listen: "prerequest",
      script: { type: "text/javascript", exec: ["pm.request.headers.add({ key: 'X-Sig', value: 'abc' });"] },
    };
    const item: PostmanRawItem = {
      id: "item-1",
      name: "Signed request",
      request: { method: "POST", url: "https://example.test/widgets", body: { mode: "formdata", formdata: [] } },
      event: [prerequest],
    };
    expect(item.event?.[0]?.listen).toBe("prerequest");
  });

  it("types a minimal CollectionView (AP-028 data-model.md)", () => {
    const variable: VariableBinding = {
      name: "token",
      value: undefined,
      source: "collection-default",
      resolved: false,
      referenced: true,
    };
    const view: CollectionView = {
      id: "uc-1",
      items: [],
      folders: [
        {
          id: "folder-1",
          name: "Widgets",
          folders: [],
          items: [
            {
              id: "item-1",
              name: "Create widget",
              wasEdited: false,
              raw: { method: "POST", url: "{{baseUrl}}/widgets", headers: [], body: undefined },
              resolved: { method: "POST", url: "https://example.test/widgets", headers: [], body: undefined },
              unresolvedVariables: [],
            },
          ],
        },
      ],
      variables: [variable],
    };
    expect(view.folders[0].items[0].wasEdited).toBe(false);
    expect(view.variables[0].referenced).toBe(true);
  });

  it("types UploadedRequestResult.wasEdited as an additive, absent-by-default field", () => {
    const result: UploadedRequestResult = {
      requestName: "Get widget",
      requestMethod: "GET",
      outcome: "passed",
      startedAt: new Date(0).toISOString(),
      durationMs: 42,
      testOutcomes: [],
    };
    expect(result.wasEdited).toBeUndefined();
  });
});
