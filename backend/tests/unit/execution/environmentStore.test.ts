import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EnvironmentInput } from "../../../src/execution/environmentStore";
import {
  createEnvironment,
  listEnvironments,
  updateEnvironment,
} from "../../../src/execution/environmentStore";
import { DuplicateEnvironmentNameError, EnvironmentNotFoundError } from "../../../src/execution/errors";
import { enterTestSession } from "../../../src/session/sessionContext";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { SqliteConnection, setSharedConnectionForTest } from "../../../src/persistence/connection";

const localInput: EnvironmentInput = {
  name: "Local",
  tier: "local",
  baseUrl: "http://localhost:4000",
  variableValues: {},
  requestDelayMs: 0,
};

describe("environmentStore", () => {
  it("creates and lists environments for the calling session", () => {
    expect(listEnvironments()).toEqual([]);
    const created = createEnvironment(localInput);
    expect(created.id).toBeDefined();
    expect(listEnvironments()).toEqual([created]);
  });

  it("updates an existing environment's fields", () => {
    const created = createEnvironment(localInput);
    const updated = updateEnvironment(created.id, { ...localInput, baseUrl: "http://localhost:5000" });
    expect(updated.id).toBe(created.id);
    expect(updated.baseUrl).toBe("http://localhost:5000");
    expect(listEnvironments()).toEqual([updated]);
  });

  it("rejects a duplicate name on create (FR-003)", () => {
    createEnvironment(localInput);
    expect(() => createEnvironment(localInput)).toThrow(DuplicateEnvironmentNameError);
  });

  it("rejects a duplicate name on update, but allows updating in place under the same name", () => {
    const first = createEnvironment(localInput);
    const second = createEnvironment({ ...localInput, name: "Staging", tier: "staging" });
    expect(() => updateEnvironment(second.id, { ...localInput, name: "Local" })).toThrow(
      DuplicateEnvironmentNameError,
    );
    expect(() => updateEnvironment(first.id, localInput)).not.toThrow();
  });

  it("throws EnvironmentNotFoundError when updating an unknown id", () => {
    expect(() => updateEnvironment("missing-id", localInput)).toThrow(EnvironmentNotFoundError);
  });

  it("keeps two sessions' environments fully isolated", () => {
    enterTestSession(randomUUID());
    createEnvironment(localInput);
    expect(listEnvironments()).toHaveLength(1);

    enterTestSession(randomUUID());
    expect(listEnvironments()).toEqual([]);
  });

  it("removes an environment when its session is idle-evicted (specs/025 research.md D4)", () => {
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    createEnvironment(localInput);
    expect(listEnvironments()).toHaveLength(1);

    forceExpireForTest(sessionId);
    expect(listEnvironments()).toEqual([]);
  });

  it("survives closing and reopening the database file, simulating a backend restart (specs/025 FR-001)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-test-"));
    const dbPath = path.join(dir, "apipilot.db");
    try {
      let connection = new SqliteConnection(dbPath);
      setSharedConnectionForTest(connection);
      const created = createEnvironment(localInput);
      connection.close();

      // Simulate a restart: a brand-new connection reopening the same on-disk file.
      connection = new SqliteConnection(dbPath);
      setSharedConnectionForTest(connection);
      expect(listEnvironments()).toEqual([created]);
      connection.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
