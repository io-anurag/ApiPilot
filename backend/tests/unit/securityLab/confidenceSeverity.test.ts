import { describe, expect, it } from "vitest";
import type { ConditionResult, SecurityScenarioContent } from "@apipilot/shared-domain";
import { getSecurityFindingRepository } from "../../../src/persistence/securityFindingRepository";
import { confidenceFor } from "../../../src/securityLab/evaluation/confidence";
import { evaluateScenario } from "../../../src/securityLab/evaluation/evaluateScenario";
import type { ExecutedResponse } from "../../../src/securityLab/evaluation/types";
import { recordFailure, type FindingContext } from "../../../src/securityLab/findings/findingService";
import { OWNER_A, T0, makeContent } from "../../fixtures/securityLab/builders";

const res = (status: number, truncated = false): ExecutedResponse => ({ index: 0, method: "GET", status, headers: {}, bodyText: "{}", truncated, durationMs: 1 });
const violated: ConditionResult[] = [{ condition: { kind: "status.not-success" }, state: "violated" }];

const documented = (overrides: Partial<SecurityScenarioContent> = {}) =>
  makeContent({ expected: { kind: "rejected", statement: "s", basis: "documented", documentedStatusCodes: [401, 403] }, ...overrides });
const productRule = (overrides: Partial<SecurityScenarioContent> = {}) =>
  makeContent({ expected: { kind: "rejected", statement: "s", basis: "product-rule", ruleId: "SL-REJECT-MISSING-CREDENTIAL" }, ...overrides });

describe("confidence is computed from the evidence and its grounding (R15)", () => {
  it("is high for a documented expectation violated by one unambiguous response, naming the documented statuses and the observed one", () => {
    const confidence = confidenceFor(documented(), [res(200)], violated);
    expect(confidence.level).toBe("high");
    expect(confidence.basis).toBe("The specification documents the documented statuses 401, 403, and the single response was status 200.");
  });

  it("is medium for a named product rule violated by one clear response, naming the rule", () => {
    const confidence = confidenceFor(productRule(), [res(200)], violated);
    expect(confidence.level).toBe("medium");
    expect(confidence.basis).toContain("SL-REJECT-MISSING-CREDENTIAL");
    expect(confidence.basis).toContain("status 200");
  });

  it("is low when the violation shows only across repeated requests, even for a documented expectation", () => {
    const repeat = documented({ mutations: [{ kind: "request.repeat", count: 5 }] });
    const confidence = confidenceFor(repeat, [res(200), res(200), res(200), res(200), res(200)], violated);
    expect(confidence.level).toBe("low");
    expect(confidence.basis).toMatch(/5 repeated requests/);
  });

  it("is low when the evidence was cut off near the decisive part", () => {
    const confidence = confidenceFor(documented(), [res(200, true)], violated);
    expect(confidence).toMatchObject({ level: "low" });
    expect(confidence.basis).toMatch(/cut off/);
  });

  it("is low for a persisted-state check, which has no stable read behind it", () => {
    const persisted = productRule({ mutations: [{ kind: "body.add-property", path: "", name: "role", valueKind: "string" }] });
    const confidence = confidenceFor(persisted, [res(200)], [{ condition: { kind: "persisted.field-unchanged", path: "role" }, state: "violated" }]);
    expect(confidence.level).toBe("low");
    expect(confidence.basis).toMatch(/not read back/);
  });

  it("always records a basis, never a bare level", () => {
    for (const scenario of [documented(), productRule(), documented({ mutations: [{ kind: "request.repeat", count: 2 }] })]) {
      expect(confidenceFor(scenario, [res(200), res(200)], violated).basis.length).toBeGreaterThan(20);
    }
  });

  it("is a pure function of the evidence", () => {
    expect(confidenceFor(documented(), [res(200)], violated)).toEqual(confidenceFor(structuredClone(documented()), [res(200)], violated));
  });

  it("is attached to an evaluation only when it failed", () => {
    const scenario = documented({ conditions: [{ kind: "status.in-set", codes: [401, 403] }] });
    expect(evaluateScenario({ content: scenario, responses: [res(200)], plannedRequests: 1, secrets: [] }).confidence?.level).toBe("high");
    expect(evaluateScenario({ content: scenario, responses: [res(401)], plannedRequests: 1, secrets: [] }).confidence).toBeUndefined();
  });
});

describe("severity is never raised by the engine", () => {
  const context = (): FindingContext => ({ ownerId: OWNER_A, repo: getSecurityFindingRepository(), now: () => new Date(T0), actor: "tester" });
  const failure = (content: SecurityScenarioContent, resultId: string) => ({
    assessmentKey: "a1",
    scenarioId: "ss-1",
    version: 1,
    content,
    resultId,
    runId: "run-1",
    observed: { responseHeadersSelected: {}, statement: "Status 200.", truncated: false },
    confidence: { level: "high" as const, basis: "b" },
  });

  it.each(["info", "low", "medium", "high", "critical"] as const)("starts a finding at the scenario's suggested severity %s, for both suggested and current", (severity) => {
    const finding = recordFailure(context(), { ...failure(makeContent({ suggestedSeverity: severity }), `r-${severity}`), scenarioId: `ss-${severity}` });
    expect(finding.severity).toEqual({ suggested: severity, current: severity });
  });

  it("keeps the severity as it is however many failures, however low the confidence, and whatever the status", () => {
    const content = makeContent({ suggestedSeverity: "medium" });
    let finding = recordFailure(context(), failure(content, "r1"));
    for (let index = 2; index <= 6; index += 1) {
      finding = recordFailure(context(), { ...failure(content, `r${index}`), confidence: { level: index % 2 === 0 ? "low" : "high", basis: "b" } });
    }
    expect(finding.severity).toEqual({ suggested: "medium", current: "medium" });
    expect(finding.occurrenceCount).toBe(6);
  });

  it("does not lower or raise the suggested severity when a person changes the current one", async () => {
    const { updateFinding } = await import("../../../src/securityLab/findings/findingService");
    const content = makeContent({ suggestedSeverity: "medium" });
    const created = recordFailure(context(), failure(content, "r1"));
    const raised = updateFinding(context(), created.id, { severity: "critical", note: "Internet facing" });
    expect(raised.severity).toEqual({ suggested: "medium", current: "critical" });
    const later = recordFailure(context(), failure(content, "r2"));
    expect(later.severity).toEqual({ suggested: "medium", current: "critical" });
  });
});
