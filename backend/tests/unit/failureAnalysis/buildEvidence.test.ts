import { describe, expect, it } from "vitest";
import type { SpecificationContext } from "@apipilot/shared-domain";
import { buildEvidence } from "../../../src/failureAnalysis/buildEvidence";
import {
  SECRET_VALUES,
  connectivityFailure,
  failedResult,
  withRawCapture,
} from "../../fixtures/failureAnalysis/fixtures";

const unavailable: SpecificationContext = { status: "unavailable", reason: "not-generated-by-current-workflow" };

const matched: SpecificationContext = {
  status: "matched",
  workflowId: "tgw-1",
  scenarioId: "scenario-get-user",
  scenarioName: "GET /users/{id} with valid input",
  scenarioCategory: "positive",
  operationPath: "/users/{id}",
  operationMethod: "GET",
  documentedStatusCodes: ["200", "404"],
  requestEditedAfterGeneration: false,
  upstream: [
    {
      via: "integration-workflow",
      stepPosition: 0,
      operationPath: "/users",
      operationMethod: "POST",
      suppliedFields: ["user_id"],
      outcomeInRun: "failed",
    },
  ],
};

describe("buildEvidence (research D4)", () => {
  it("emits run-result evidence in the fixed kind order with sequential ids", () => {
    const result = failedResult({
      testOutcomes: [
        { name: "Status code is 201", outcome: "failed", detail: "expected 201 but got 500" },
        { name: "Body is JSON", outcome: "passed" },
      ],
    });
    const { evidence } = buildEvidence(result, unavailable);

    expect(evidence.map((item) => [item.id, item.kind, item.source])).toEqual([
      ["E1", "failure-category", "run-result"],
      ["E2", "response-status", "run-result"],
      ["E3", "response-time", "run-result"],
      ["E4", "test-outcome", "run-result"],
      ["E5", "test-outcome", "run-result"],
    ]);
    expect(evidence[3].text).toBe('Test "Status code is 201" failed: expected 201 but got 500');
    expect(evidence[4].text).toBe('Test "Body is JSON" passed');
  });

  it("adds raw-capture evidence only when a capture exists, fully redacted", () => {
    const withCapture = buildEvidence(withRawCapture(failedResult()), unavailable);
    const kinds = withCapture.evidence.map((item) => item.kind);

    expect(kinds).toEqual([
      "failure-category",
      "response-status",
      "response-time",
      "test-outcome",
      "request-line",
      "request-headers",
      "request-body-excerpt",
      "response-headers",
      "response-body-excerpt",
    ]);
    const allText = withCapture.evidence.map((item) => item.text).join("\n");
    for (const secret of SECRET_VALUES) expect(allText).not.toContain(secret);
    expect(withCapture.sensitiveValues).toEqual(expect.arrayContaining([...SECRET_VALUES]));

    expect(buildEvidence(failedResult(), unavailable).evidence.map((item) => item.kind)).not.toContain(
      "request-line",
    );
  });

  it("adds request-edited only for an edited request", () => {
    expect(buildEvidence(failedResult({ wasEdited: true }), unavailable).evidence.map((i) => i.kind)).toContain(
      "request-edited",
    );
    expect(buildEvidence(failedResult(), unavailable).evidence.map((i) => i.kind)).not.toContain(
      "request-edited",
    );
  });

  it("gives a bare connectivity failure only its failure category", () => {
    expect(buildEvidence(connectivityFailure(), unavailable).evidence).toEqual([
      {
        id: "E1",
        kind: "failure-category",
        source: "run-result",
        text: "Request failed: connectivity failure, no response was received",
      },
    ]);
  });

  it("summarizes passed tests beyond the first five by count", () => {
    const testOutcomes = Array.from({ length: 8 }, (_, index) => ({
      name: `passes ${index}`,
      outcome: "passed" as const,
    }));
    const { evidence } = buildEvidence(failedResult({ testOutcomes }), unavailable);
    const tests = evidence.filter((item) => item.kind === "test-outcome");
    expect(tests).toHaveLength(6);
    expect(tests[5].text).toBe("3 more tests passed");
  });

  it("is deterministic", () => {
    const result = withRawCapture(failedResult());
    expect(buildEvidence(result, matched)).toEqual(buildEvidence(result, matched));
  });

  it("appends specification-context evidence after run-result evidence when context is matched", () => {
    const { evidence } = buildEvidence(failedResult(), matched);
    const specification = evidence.filter((item) => item.source === "specification-context");

    expect(specification.map((item) => [item.kind, item.text])).toEqual([
      ["documented-responses", "Operation GET /users/{id} documents responses: 200, 404"],
      ["scenario-expectation", 'Generated from scenario "GET /users/{id} with valid input" (category: positive)'],
      ["upstream-step-outcome", "Upstream workflow step 0 POST /users (supplies user_id): failed in this run"],
    ]);
    const lastRunResultIndex = evidence.map((item) => item.source).lastIndexOf("run-result");
    const firstSpecIndex = evidence.findIndex((item) => item.source === "specification-context");
    expect(lastRunResultIndex).toBeLessThan(firstSpecIndex);
  });

  it("adds no specification-context evidence when context is unavailable", () => {
    expect(
      buildEvidence(failedResult(), unavailable).evidence.some((item) => item.source === "specification-context"),
    ).toBe(false);
  });

  it("drops bodies, then headers, and records the omission when trimming for capacity", () => {
    const result = withRawCapture(failedResult());
    const withoutBodies = buildEvidence(result, unavailable, { omitBodies: true }).evidence;
    expect(withoutBodies.map((item) => item.kind)).not.toContain("request-body-excerpt");
    expect(withoutBodies.at(-1)?.text).toBe(
      "Some evidence (body excerpts) was omitted to fit the model's input capacity",
    );

    const minimal = buildEvidence(result, unavailable, { omitBodies: true, omitHeaders: true }).evidence;
    expect(minimal.map((item) => item.kind)).not.toContain("request-headers");
    expect(minimal.at(-1)?.kind).toBe("omitted-for-capacity");
  });
});
