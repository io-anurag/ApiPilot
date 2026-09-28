import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { enterTestSession } from "../../../src/session/sessionContext";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import {
  contextFromQuickTest,
  getQuickTest,
  hasQuickTest,
  resetQuickTestsForTest,
  setQuickTest,
  updateQuickTest,
  type QuickPerformanceTest,
} from "../../../src/performance/quick/quickTestStore";
import { planFixture } from "../../fixtures/performance/builders";

/** AP-032 research Q1 (specs/032-quick-performance-test tasks T026). */

function quickTest(filename: string): QuickPerformanceTest {
  return {
    id: randomUUID(),
    specification: { filename, operationCount: 0 },
    apiModel: { operations: [], securitySchemes: {}, summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] } },
    scenarios: [],
    plan: planFixture({ source: "quick" }),
  };
}

describe("quickTestStore", () => {
  beforeEach(() => {
    resetQuickTestsForTest();
    enterTestSession(randomUUID());
  });

  it("keeps one quick test per session and replaces it on set", () => {
    expect(hasQuickTest()).toBe(false);
    setQuickTest(quickTest("a.yaml"));
    setQuickTest(quickTest("b.yaml"));
    expect(getQuickTest()?.specification.filename).toBe("b.yaml");
  });

  it("does not leak between sessions", () => {
    setQuickTest(quickTest("a.yaml"));
    enterTestSession(randomUUID());
    expect(getQuickTest()).toBeUndefined();
  });

  it("updates the plan and script in place, and refuses an update with no quick test", () => {
    setQuickTest(quickTest("a.yaml"));
    const updated = updateQuickTest({ plan: planFixture({ source: "quick", thinkTimeMs: 500 }) });
    expect(getQuickTest()?.plan.thinkTimeMs).toBe(500);
    expect(updated.specification.filename).toBe("a.yaml");
    enterTestSession(randomUUID());
    expect(() => updateQuickTest({})).toThrow();
  });

  it("is cleared when the session expires", () => {
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    setQuickTest(quickTest("a.yaml"));
    forceExpireForTest(sessionId);
    expect(getQuickTest()).toBeUndefined();
  });

  it("gives a context with every operation in scope, no workflows and the quick source", () => {
    const context = contextFromQuickTest(quickTest("a.yaml"));
    expect(context).toMatchObject({ workflows: [], relationships: [], selectedOperationKeys: undefined, source: "quick" });
  });
});
