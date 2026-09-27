import { randomUUID } from "node:crypto";
import type { ApiModel } from "@apipilot/shared-domain";
import { beforeEach, describe, expect, it } from "vitest";
import { enterTestSession } from "../../../src/session/sessionContext";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import {
  clearGeneratedScript,
  getGeneratedScript,
  setGeneratedScript,
  type GeneratedScript,
} from "../../../src/performance/scriptStore";
import { resetStore, startWorkflow } from "../../../src/testGenerationWorkflow/workflowStore";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

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

describe("scriptStore (AP-029 data-model 'Generated script')", () => {
  beforeEach(() => resetStore());

  it("keeps one script per session, for the current workflow only", () => {
    startWorkflow({ specificationFilename: "a.yaml", apiModel });
    setGeneratedScript(script("f1"));
    expect(getGeneratedScript()?.planFingerprint).toBe("f1");

    startWorkflow({ specificationFilename: "b.yaml", apiModel });
    expect(getGeneratedScript()).toBeUndefined();
  });

  it("does not leak between sessions", () => {
    startWorkflow({ specificationFilename: "a.yaml", apiModel });
    setGeneratedScript(script("f1"));
    enterTestSession(randomUUID());
    startWorkflow({ specificationFilename: "a.yaml", apiModel });
    expect(getGeneratedScript()).toBeUndefined();
  });

  it("is cleared explicitly and when the session expires", () => {
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    startWorkflow({ specificationFilename: "a.yaml", apiModel });
    setGeneratedScript(script("f1"));
    clearGeneratedScript();
    expect(getGeneratedScript()).toBeUndefined();

    setGeneratedScript(script("f2"));
    forceExpireForTest(sessionId);
    expect(getGeneratedScript()).toBeUndefined();
  });
});
