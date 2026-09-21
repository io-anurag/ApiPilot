import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { enterTestSession } from "../../../src/session/sessionContext";
import { getSharedConnection } from "../../../src/persistence/connection";
import {
  getUploadedCollectionRepository,
  type UploadedCollectionInput,
} from "../../../src/persistence/uploadedCollectionRepository";
import { DuplicateNameError, UploadedCollectionNotFoundError } from "../../../src/externalCollections/errors";

const input: UploadedCollectionInput = {
  name: "My collection",
  tier: "local",
  collection: '{"info":{"name":"c"},"item":[]}',
  variableValues: { token: "super-secret" },
  requestDelayMs: 0,
};

describe("uploadedCollectionRepository", () => {
  it("round-trips create/get, decrypting variableValues on the way out", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);

    const created = repository.create(sessionId, randomUUID(), new Date(0).toISOString(), input);
    const fetched = repository.get(sessionId, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.variableValues).toEqual({ token: "super-secret" });
  });

  it("stores variableValues encrypted at rest — the raw row never contains the plaintext value", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const created = repository.create(sessionId, randomUUID(), new Date(0).toISOString(), input);

    const row = getSharedConnection()
      .db.prepare("SELECT variable_values_encrypted FROM uploaded_collections WHERE id = ?")
      .get(created.id) as { variable_values_encrypted: Buffer };
    expect(row.variable_values_encrypted.toString("utf-8")).not.toContain("super-secret");
  });

  it("lists newest first and removes by id", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const first = repository.create(sessionId, randomUUID(), "2026-01-01T00:00:00.000Z", input);
    const second = repository.create(
      sessionId,
      randomUUID(),
      "2026-01-02T00:00:00.000Z",
      { ...input, name: "Second" },
    );

    expect(repository.list(sessionId).map((c) => c.id)).toEqual([second.id, first.id]);

    repository.remove(sessionId, first.id);
    expect(repository.get(sessionId, first.id)).toBeUndefined();
    expect(repository.list(sessionId).map((c) => c.id)).toEqual([second.id]);
  });

  it("refuses a duplicate name within the same session", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    repository.create(sessionId, randomUUID(), new Date(0).toISOString(), input);
    expect(() => repository.create(sessionId, randomUUID(), new Date(0).toISOString(), input)).toThrow(
      DuplicateNameError,
    );
  });

  it("throws UploadedCollectionNotFoundError removing an unknown id", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    expect(() => repository.remove(sessionId, randomUUID())).toThrow(UploadedCollectionNotFoundError);
  });

  it("sets confirmedAt via markConfirmed", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const created = repository.create(sessionId, randomUUID(), new Date(0).toISOString(), input);
    expect(created.confirmedAt).toBeUndefined();

    repository.markConfirmed(sessionId, created.id, "2026-01-01T00:00:00.000Z");
    expect(repository.get(sessionId, created.id)?.confirmedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("updateVariableValues replaces variableValues wholesale, still encrypted at rest (AP-028)", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const created = repository.create(sessionId, randomUUID(), new Date(0).toISOString(), input);

    const updated = repository.updateVariableValues(sessionId, created.id, { token: "new-secret", extra: "value" });
    expect(updated.variableValues).toEqual({ token: "new-secret", extra: "value" });
    expect(repository.get(sessionId, created.id)?.variableValues).toEqual({ token: "new-secret", extra: "value" });

    const row = getSharedConnection()
      .db.prepare("SELECT variable_values_encrypted FROM uploaded_collections WHERE id = ?")
      .get(created.id) as { variable_values_encrypted: Buffer };
    expect(row.variable_values_encrypted.toString("utf-8")).not.toContain("new-secret");
  });

  it("updateVariableValues throws UploadedCollectionNotFoundError for an unknown id", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    expect(() => repository.updateVariableValues(sessionId, randomUUID(), {})).toThrow(UploadedCollectionNotFoundError);
  });

  it("updateCollectionBody replaces the stored collection JSON exactly as given (AP-028)", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const created = repository.create(sessionId, randomUUID(), new Date(0).toISOString(), input);

    const newCollection = '{"info":{"name":"c"},"item":[{"id":"item-1","name":"Edited"}]}';
    const updated = repository.updateCollectionBody(sessionId, created.id, newCollection);
    expect(updated.collection).toBe(newCollection);
    expect(repository.get(sessionId, created.id)?.collection).toBe(newCollection);
  });

  it("updateCollectionBody throws UploadedCollectionNotFoundError for an unknown id", () => {
    const repository = getUploadedCollectionRepository();
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    expect(() => repository.updateCollectionBody(sessionId, randomUUID(), "{}")).toThrow(
      UploadedCollectionNotFoundError,
    );
  });
});
