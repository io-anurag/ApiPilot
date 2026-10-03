import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { enterTestSession } from "../../../src/session/sessionContext";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { deleteChainScript, getChainScript, saveChainScript, type GeneratedScript } from "../../../src/performance/scriptStore";

/** AP-037 (specs/037-request-chain-performance research R22): request-chain scripts, per session and plan. */

function script(fingerprint: string): GeneratedScript {
  return {
    planFingerprint: fingerprint,
    scriptSha256: "s".repeat(64),
    environmentTemplateSha256: "t".repeat(64),
    script: "// script",
    environmentTemplate: "{}\n",
    stepCount: 1,
    valueIndex: { baseUrl: 0 },
  };
}

describe("scriptStore", () => {
  beforeEach(() => enterTestSession(randomUUID()));

  it("keeps one script per plan, replaced on save and removed on delete", () => {
    saveChainScript("p1", script("f1"));
    saveChainScript("p2", script("f2"));
    saveChainScript("p1", script("f3"));
    expect(getChainScript("p1")?.planFingerprint).toBe("f3");
    expect(getChainScript("p2")?.planFingerprint).toBe("f2");
    deleteChainScript("p1");
    expect(getChainScript("p1")).toBeUndefined();
    expect(getChainScript("p2")).toBeDefined();
  });

  it("does not leak between sessions", () => {
    saveChainScript("p1", script("f1"));
    enterTestSession(randomUUID());
    expect(getChainScript("p1")).toBeUndefined();
  });

  it("is cleared when the session expires", () => {
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    saveChainScript("p1", script("f1"));
    forceExpireForTest(sessionId);
    expect(getChainScript("p1")).toBeUndefined();
  });
});
