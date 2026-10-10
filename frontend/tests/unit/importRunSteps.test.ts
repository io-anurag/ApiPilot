import { describe, expect, it } from "vitest";
import {
  IMPORT_RUN_STEP_ORDER,
  getStepLockReason,
  resolveStep,
} from "../../src/components/importRunSteps";

const none = { hasCollection: false, hasRuns: false };
const collectionOnly = { hasCollection: true, hasRuns: false };
const withRuns = { hasCollection: true, hasRuns: true };

describe("import & run steps", () => {
  it("opens only the Collection step until a collection is selected", () => {
    expect(getStepLockReason("collection", none)).toBeUndefined();
    for (const step of ["review", "run", "results"] as const) {
      expect(getStepLockReason(step, none)).toBe("Select a collection first");
    }
  });

  it("opens Review and Run with a collection, and Results only once it has a run", () => {
    expect(getStepLockReason("review", collectionOnly)).toBeUndefined();
    expect(getStepLockReason("run", collectionOnly)).toBeUndefined();
    expect(getStepLockReason("results", collectionOnly)).toBe("Start a run first");
    expect(getStepLockReason("results", withRuns)).toBeUndefined();
  });

  it("keeps a requested step that is open", () => {
    for (const step of IMPORT_RUN_STEP_ORDER) {
      expect(resolveStep(step, withRuns)).toBe(step);
    }
  });

  it("falls back to the furthest earlier open step when the requested one is locked", () => {
    expect(resolveStep("results", collectionOnly)).toBe("run");
    expect(resolveStep("run", none)).toBe("collection");
    expect(resolveStep("results", none)).toBe("collection");
  });
});
