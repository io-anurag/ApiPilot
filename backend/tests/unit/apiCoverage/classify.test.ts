import { describe, expect, it } from "vitest";
import { classifyRequirement, type MappedScenario } from "../../../src/apiCoverage/classify";
import type { EvidenceCheck, ScenarioEvidence } from "../../../src/apiCoverage/evidence";

const evidence = (over: Partial<ScenarioEvidence> = {}): ScenarioEvidence => ({
  scenarioId: "s1",
  runId: "r1",
  runKind: "uploaded",
  startedAt: "2026-10-10T10:00:00.000Z",
  outcome: "passed",
  noResponse: false,
  edited: false,
  checks: [{ kind: "status-code", expectedStatusCode: "201", outcome: "passed" }],
  ...over,
});
const mapped = (over: Partial<MappedScenario> = {}): MappedScenario => ({ scenarioId: "s1", scope: "any", ...over });
const classify = (m: MappedScenario[], ev: Record<string, ScenarioEvidence>) => classifyRequirement(m, (id) => ev[id]);

describe("classifyRequirement", () => {
  it("is not covered when no scenario is mapped", () => {
    expect(classify([], {}).state).toBe("not-covered");
  });

  it("is generated-not-executed when scenarios exist without evidence", () => {
    expect(classify([mapped()], {}).state).toBe("generated-not-executed");
  });

  it("is verified only when an evaluated check passed", () => {
    expect(classify([mapped()], { s1: evidence() }).state).toBe("verified");
  });

  it("is inconclusive for a successful response with no evaluated check", () => {
    expect(classify([mapped()], { s1: evidence({ checks: [] }) }).state).toBe("inconclusive");
    const notEvaluated: EvidenceCheck[] = [{ kind: "status-code", expectedStatusCode: "201", outcome: "not-evaluated" }];
    expect(classify([mapped()], { s1: evidence({ checks: notEvaluated }) }).state).toBe("inconclusive");
  });

  it("is executed-failed when a relevant check failed, and never verified", () => {
    const failing = evidence({ outcome: "failed", checks: [{ kind: "status-code", expectedStatusCode: "201", outcome: "failed" }] });
    expect(classify([mapped()], { s1: failing }).state).toBe("executed-failed");
  });

  it("lets a failure outrank a pass across several scenarios", () => {
    const failing = evidence({ scenarioId: "s2", outcome: "failed", checks: [{ kind: "status-code", outcome: "failed" }] });
    const result = classify([mapped(), mapped({ scenarioId: "s2" })], { s1: evidence(), s2: failing });
    expect(result.state).toBe("executed-failed");
  });

  it("is verified when one scenario verifies and another is merely inconclusive", () => {
    const weak = evidence({ scenarioId: "s2", checks: [] });
    expect(classify([mapped(), mapped({ scenarioId: "s2" })], { s1: evidence(), s2: weak }).state).toBe("verified");
  });

  it("is inconclusive for an edited request or when no response was received", () => {
    expect(classify([mapped()], { s1: evidence({ edited: true }) }).state).toBe("inconclusive");
    expect(classify([mapped()], { s1: evidence({ noResponse: true, outcome: "failed", checks: [] }) }).state).toBe("inconclusive");
  });

  it("scopes verification to the relevant check", () => {
    const schemaFailed = evidence({
      outcome: "failed",
      checks: [
        { kind: "status-code", expectedStatusCode: "201", outcome: "passed" },
        { kind: "schema-conformance", outcome: "failed" },
      ],
    });
    expect(classify([mapped({ scope: "status-code", responseCode: "201" })], { s1: schemaFailed }).state).toBe("verified");
    expect(classify([mapped({ scope: "schema-conformance" })], { s1: schemaFailed }).state).toBe("executed-failed");
    expect(classify([mapped({ scope: "any" })], { s1: schemaFailed }).state).toBe("executed-failed");
  });

  it("keeps Stale reserved: evidence flagged for revalidation is stale, never verified", () => {
    expect(classify([mapped()], { s1: evidence({ stale: true }) }).state).toBe("stale");
  });

  it("bounds and orders evidence references, failures first", () => {
    const ids = ["s1", "s2", "s3", "s4", "s5"];
    const evs = Object.fromEntries(
      ids.map((id) => [
        id,
        evidence({
          scenarioId: id,
          outcome: id === "s5" ? "failed" : "passed",
          checks: [{ kind: "status-code", outcome: id === "s5" ? "failed" : "passed" }],
        }),
      ]),
    );
    const result = classify(
      ids.map((id) => mapped({ scenarioId: id })),
      evs,
    );
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence[0].scenarioId).toBe("s5");
  });
});

describe("classifyRequirement: check scopes, causes and tally (coverage-rules.md 5.2, 6)", () => {
  const statusPassed: EvidenceCheck = { kind: "status-code", expectedStatusCode: "201", outcome: "passed" };
  const schemaFailed: EvidenceCheck = { kind: "schema-conformance", outcome: "failed" };

  it("judges an exercised requirement by the status check only, so a failing schema check does not fail it", () => {
    const ev = evidence({ outcome: "failed", checks: [statusPassed, schemaFailed] });
    expect(classify([mapped({ scope: "status" })], { s1: ev }).state).toBe("verified");
    expect(classify([mapped({ scope: "schema-conformance" })], { s1: ev })).toMatchObject({ state: "executed-failed", cause: "assertion-failed" });
    expect(classify([mapped({ scope: "status-code", responseCode: "201" })], { s1: ev }).state).toBe("verified");
  });

  it("reports a failed relevant check with the assertion-failed cause", () => {
    const failed = evidence({ outcome: "failed", checks: [{ kind: "status-code", expectedStatusCode: "201", outcome: "failed" }] });
    expect(classify([mapped({ scope: "status" })], { s1: failed })).toMatchObject({ state: "executed-failed", cause: "assertion-failed" });
  });

  it("never labels a missing response as an assertion failure", () => {
    const timedOut = evidence({ outcome: "failed", noResponse: true, checks: [{ kind: "status-code", expectedStatusCode: "201", outcome: "not-evaluated" }] });
    expect(classify([mapped({ scope: "status" })], { s1: timedOut })).toMatchObject({ state: "inconclusive", cause: "transport-error" });
  });

  it("separates an unevaluated check, a missing check and an edited request", () => {
    const unevaluated = evidence({ checks: [{ kind: "status-code", expectedStatusCode: "201", outcome: "not-evaluated" }] });
    expect(classify([mapped({ scope: "status" })], { s1: unevaluated })).toMatchObject({ state: "inconclusive", cause: "check-not-evaluated" });
    expect(classify([mapped({ scope: "schema-conformance" })], { s1: evidence() })).toMatchObject({ state: "inconclusive", cause: "no-relevant-check" });
    expect(classify([mapped({ scope: "status" })], { s1: evidence({ edited: true }) })).toMatchObject({ state: "inconclusive", cause: "request-edited" });
  });

  it("tallies every mapped scenario so a failure never hides passes and a pass never hides unexecuted ones", () => {
    const failed = evidence({ scenarioId: "s2", outcome: "failed", checks: [{ kind: "status-code", expectedStatusCode: "201", outcome: "failed" }] });
    const result = classify(
      [mapped({ scenarioId: "s1", scope: "status" }), mapped({ scenarioId: "s2", scope: "status" }), mapped({ scenarioId: "s3", scope: "status" })],
      { s1: evidence(), s2: failed },
    );
    expect(result.state).toBe("executed-failed");
    expect(result.tally).toEqual({ passed: 1, failed: 1, inconclusive: 0, notExecuted: 1 });
    const verifiedWithSibling = classify([mapped({ scenarioId: "s1", scope: "status" }), mapped({ scenarioId: "s3", scope: "status" })], { s1: evidence() });
    expect(verifiedWithSibling.state).toBe("verified");
    expect(verifiedWithSibling.tally).toEqual({ passed: 1, failed: 0, inconclusive: 0, notExecuted: 1 });
  });

  it("explains an unexecuted requirement with the most specific recorded cause", () => {
    const result = classifyRequirement(
      [mapped({ scenarioId: "s1" }), mapped({ scenarioId: "s2" })],
      () => undefined,
      (id) => (id === "s1" ? "never-run" : "blocked-by-dependency"),
    );
    expect(result).toMatchObject({ state: "generated-not-executed", cause: "blocked-by-dependency" });
  });

  it("keeps stale distinct from generated-not-executed and carries its reason and re-execution flag", () => {
    const stale = evidence({ stale: true, staleReason: "maxLength changed from 80 to 100", staleSince: "rev b20d44" });
    const result = classify([mapped({ scope: "status" })], { s1: stale });
    expect(result).toMatchObject({
      state: "stale",
      staleReason: "maxLength changed from 80 to 100",
      staleSince: "rev b20d44",
      reExecutionRequired: true,
    });
    expect(result.state).not.toBe("generated-not-executed");
    expect(result.evidence).toHaveLength(1);
  });
});
