import { describe, expect, it } from "vitest";
import { createRun, settleRun } from "../../../src/externalCollections/uploadedCollectionExecutionStore";
import { assertCollectionNotRunning } from "../../../src/externalCollections/runLock";
import { CollectionLockedError } from "../../../src/externalCollections/errors";

const snapshot = { name: "My collection", tier: "local" as const };

describe("assertCollectionNotRunning", () => {
  it("throws CollectionLockedError while a run of this collection is in progress", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    expect(() => assertCollectionNotRunning("uc-1")).toThrow(CollectionLockedError);
    settleRun(run.id, "completed");
  });

  it("passes when there is no run at all", () => {
    expect(() => assertCollectionNotRunning("uc-with-no-runs")).not.toThrow();
  });

  it("passes once the run reaches a terminal status", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-2", uploadedCollectionSnapshot: snapshot });
    settleRun(run.id, "completed");
    expect(() => assertCollectionNotRunning("uc-2")).not.toThrow();
  });

  it("is unaffected by a different collection's in-progress run", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-3", uploadedCollectionSnapshot: snapshot });
    expect(() => assertCollectionNotRunning("uc-4")).not.toThrow();
    settleRun(run.id, "completed");
  });
});
