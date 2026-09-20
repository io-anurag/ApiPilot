import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createUploadedCollection,
  getUploadedCollection,
  listUploadedCollections,
  markUploadedCollectionConfirmed,
  removeUploadedCollection,
  type UploadedCollectionInput,
} from "../../../src/externalCollections/uploadedCollectionStore";
import { DuplicateNameError, UploadedCollectionNotFoundError } from "../../../src/externalCollections/errors";
import { enterTestSession } from "../../../src/session/sessionContext";

const input: UploadedCollectionInput = {
  name: "My collection",
  tier: "local",
  collection: '{"info":{"name":"c"},"item":[]}',
  variableValues: {},
  requestDelayMs: 0,
};

describe("uploadedCollectionStore", () => {
  it("creates, lists, gets, and removes for the calling session", () => {
    expect(listUploadedCollections()).toEqual([]);
    const created = createUploadedCollection(input);
    expect(listUploadedCollections()).toEqual([created]);
    expect(getUploadedCollection(created.id)).toEqual(created);

    removeUploadedCollection(created.id);
    expect(listUploadedCollections()).toEqual([]);
  });

  it("refuses a duplicate name within the same session", () => {
    createUploadedCollection(input);
    expect(() => createUploadedCollection(input)).toThrow(DuplicateNameError);
  });

  it("allows the same name across two different sessions", () => {
    createUploadedCollection(input);
    enterTestSession(randomUUID());
    expect(() => createUploadedCollection(input)).not.toThrow();
  });

  it("throws UploadedCollectionNotFoundError getting/removing an unknown id", () => {
    expect(() => getUploadedCollection(randomUUID())).toThrow(UploadedCollectionNotFoundError);
    expect(() => removeUploadedCollection(randomUUID())).toThrow(UploadedCollectionNotFoundError);
  });

  it("sets confirmedAt via markUploadedCollectionConfirmed", () => {
    const created = createUploadedCollection(input);
    expect(created.confirmedAt).toBeUndefined();
    markUploadedCollectionConfirmed(created.id);
    expect(getUploadedCollection(created.id).confirmedAt).toBeDefined();
  });
});
