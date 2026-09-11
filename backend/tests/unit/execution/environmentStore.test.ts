import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { EnvironmentInput } from "../../../src/execution/environmentStore";
import {
  createEnvironment,
  listEnvironments,
  resetEnvironmentStore,
  updateEnvironment,
} from "../../../src/execution/environmentStore";
import { DuplicateEnvironmentNameError, EnvironmentNotFoundError } from "../../../src/execution/errors";
import { enterTestSession } from "../../../src/session/sessionContext";

const localInput: EnvironmentInput = {
  name: "Local",
  tier: "local",
  baseUrl: "http://localhost:4000",
  variableValues: {},
  requestDelayMs: 0,
};

describe("environmentStore", () => {
  beforeEach(() => resetEnvironmentStore());

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
});
