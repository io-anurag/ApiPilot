import { describe, expect, it } from "vitest";
import type { FailureEvidence, SpecificationContext, UploadedRequestResult } from "@apipilot/shared-domain";
import { buildEvidence } from "../../../src/failureAnalysis/buildEvidence";
import {
  FAILURE_CLASSIFICATION_RULESET_VERSION,
  classifyFailure,
  namesAnotherService,
} from "../../../src/failureAnalysis/classifyFailure";
import { matchSpecificationContext } from "../../../src/failureAnalysis/matchSpecificationContext";
import { EVALUATION_CORPUS } from "../../fixtures/failureAnalysis/evaluationCorpus";
import { connectivityFailure, failedResult, withRawCapture } from "../../fixtures/failureAnalysis/fixtures";
import { completedWorkflow } from "../../fixtures/failureAnalysis/workflowFixtures";

/** Rule-decided causes (specs/030-ai-failure-analysis research D15). */

const unavailable: SpecificationContext = { status: "unavailable", reason: "not-generated-by-current-workflow" };

function matched(documentedStatusCodes: string[]): SpecificationContext {
  return {
    status: "matched",
    workflowId: "tgw-1",
    scenarioId: "s",
    scenarioName: "POST /users with valid input",
    scenarioCategory: "positive",
    operationPath: "/users",
    operationMethod: "POST",
    documentedStatusCodes,
    requestEditedAfterGeneration: false,
    upstream: [],
  };
}

function classify(result: UploadedRequestResult, context: SpecificationContext = unavailable) {
  const { evidence } = buildEvidence(result, context);
  return { conclusion: classifyFailure(result, context, evidence), evidence };
}

function kindsOf(ids: readonly string[], evidence: readonly FailureEvidence[]) {
  return ids.map((id) => evidence.find((item) => item.id === id)?.kind);
}

const statusTest = (expected: number, got: number) => [
  {
    name: `Status code is ${expected}`,
    outcome: "failed" as const,
    detail: `expected response to have status code ${expected} but got ${got}`,
  },
];

function withBody(status: number, body: string): UploadedRequestResult {
  return withRawCapture(failedResult({ responseStatusCode: status, testOutcomes: statusTest(200, status) }), {
    requestUrl: "http://api.example.test/orders",
    requestHeaders: [],
    responseHeaders: [{ key: "Content-Type", value: "application/json" }],
    responseBody: body,
  });
}

describe("classifyFailure (research D15)", () => {
  it("is versioned", () => {
    expect(FAILURE_CLASSIFICATION_RULESET_VERSION).toBe(1);
  });

  describe("rule 1: no-response", () => {
    it.each(["connectivity-failure", "timeout"] as const)("decides %s as a high-strength environment issue", (category) => {
      const { conclusion, evidence } = classify(connectivityFailure({ failureCategory: category }));
      expect(conclusion).toMatchObject({ kind: "likely-cause", cause: "environment-issue", strength: "high", ruleId: "no-response" });
      if (conclusion.kind === "likely-cause") expect(kindsOf(conclusion.decidingEvidenceIds, evidence)).toEqual(["failure-category"]);
    });
  });

  describe("rule 2: gateway-error", () => {
    it.each([502, 504])("decides %i as a moderate environment issue", (status) => {
      const { conclusion } = classify(failedResult({ responseStatusCode: status, testOutcomes: statusTest(200, status) }));
      expect(conclusion).toMatchObject({ cause: "environment-issue", strength: "moderate", ruleId: "gateway-error" });
    });

    it("wins over a body that names a service, because a gateway error means the API was not reached", () => {
      const { conclusion } = classify(withBody(502, "upstream payment-service unreachable"));
      expect(conclusion).toMatchObject({ ruleId: "gateway-error" });
    });
  });

  describe("rule 3: environment-rejected-request", () => {
    it.each([401, 403, 407, 408, 429])("decides %i as a moderate environment issue", (status) => {
      const { conclusion } = classify(failedResult({ responseStatusCode: status, testOutcomes: statusTest(200, status) }));
      expect(conclusion).toMatchObject({ cause: "environment-issue", strength: "moderate", ruleId: "environment-rejected-request" });
    });

    it("is decided by rule 3, not rule 6, even though a status test failed", () => {
      const { conclusion } = classify(failedResult({ responseStatusCode: 401, testOutcomes: statusTest(200, 401) }));
      expect(conclusion).toMatchObject({ ruleId: "environment-rejected-request" });
    });
  });

  describe("rule 4: dependency-named-in-server-error", () => {
    it.each([500, 503])("decides a %i whose body names another service as a moderate downstream issue", (status) => {
      const { conclusion, evidence } = classify(withBody(status, JSON.stringify({ error: "payment-service did not respond" })));
      expect(conclusion).toMatchObject({
        cause: "downstream-service-issue",
        strength: "moderate",
        ruleId: "dependency-named-in-server-error",
      });
      if (conclusion.kind === "likely-cause") {
        expect(kindsOf(conclusion.decidingEvidenceIds, evidence)).toEqual(["response-status", "response-body-excerpt"]);
      }
    });

    it("does not treat Envoy's 'upstream connect error' as a named dependency", () => {
      const { conclusion } = classify(withBody(503, "upstream connect error or disconnect/reset before headers"));
      expect(conclusion).toEqual({ kind: "insufficient-evidence", reason: "no-rule-matched" });
    });

    it("needs a recorded body: a bare 500 matches no rule", () => {
      const { conclusion } = classify(failedResult());
      expect(conclusion).toEqual({ kind: "insufficient-evidence", reason: "no-rule-matched" });
    });
  });

  describe("rule 5: undocumented-status", () => {
    it("decides a status the operation does not document as a high-strength specification mismatch", () => {
      const context = matched(["201", "400"]);
      const { conclusion, evidence } = classify(failedResult({ responseStatusCode: 200, testOutcomes: statusTest(201, 200) }), context);
      expect(conclusion).toMatchObject({ cause: "specification-mismatch", strength: "high", ruleId: "undocumented-status" });
      if (conclusion.kind === "likely-cause") {
        expect(kindsOf(conclusion.decidingEvidenceIds, evidence)).toEqual(["response-status", "documented-responses"]);
      }
    });

    it("wins over rule 6 when both apply", () => {
      const { conclusion } = classify(failedResult({ responseStatusCode: 200, testOutcomes: statusTest(201, 200) }), matched(["201"]));
      expect(conclusion).toMatchObject({ ruleId: "undocumented-status" });
    });

    it("treats 2XX-style ranges as documented", () => {
      const { conclusion } = classify(failedResult({ responseStatusCode: 202, testOutcomes: statusTest(201, 202) }), matched(["2XX"]));
      expect(conclusion).toMatchObject({ ruleId: "status-assertion-mismatch" });
    });

    it("does not apply when the operation documents a default response", () => {
      const { conclusion } = classify(failedResult({ responseStatusCode: 200, testOutcomes: statusTest(201, 200) }), matched(["201", "default"]));
      expect(conclusion).toMatchObject({ ruleId: "status-assertion-mismatch" });
    });

    it("does not apply to a 404, which stays unclassified", () => {
      const { conclusion } = classify(failedResult({ responseStatusCode: 404, testOutcomes: statusTest(201, 404) }), matched(["201"]));
      expect(conclusion).toEqual({ kind: "insufficient-evidence", reason: "no-rule-matched" });
    });
  });

  describe("rule 6: status-assertion-mismatch", () => {
    it.each([200, 201, 400, 409, 422])("decides a received %i against a test expecting another status as a moderate specification mismatch", (status) => {
      const { conclusion, evidence } = classify(failedResult({ responseStatusCode: status, testOutcomes: statusTest(status === 201 ? 200 : 201, status) }));
      expect(conclusion).toMatchObject({ cause: "specification-mismatch", strength: "moderate", ruleId: "status-assertion-mismatch" });
      if (conclusion.kind === "likely-cause") {
        expect(kindsOf(conclusion.decidingEvidenceIds, evidence)).toEqual(["response-status", "test-outcome"]);
      }
    });

    it("does not apply to a 404", () => {
      const { conclusion } = classify(failedResult({ responseStatusCode: 404, testOutcomes: statusTest(200, 404) }));
      expect(conclusion).toEqual({ kind: "insufficient-evidence", reason: "no-rule-matched" });
    });
  });

  describe("rule 7: response-content-assertion", () => {
    it("decides a 2xx with a failed content test that has a reason as a moderate specification mismatch", () => {
      const { conclusion, evidence } = classify(
        failedResult({
          responseStatusCode: 200,
          testOutcomes: [
            { name: "Status code is 200", outcome: "passed" },
            { name: "Response matches schema", outcome: "failed", detail: "data should have required property 'name'" },
          ],
        }),
      );
      expect(conclusion).toMatchObject({ cause: "specification-mismatch", strength: "moderate", ruleId: "response-content-assertion" });
      if (conclusion.kind === "likely-cause") {
        expect(kindsOf(conclusion.decidingEvidenceIds, evidence)).toEqual(["response-status", "test-outcome"]);
      }
    });

    it("needs a reason on every failed test: a bare failed test matches no rule", () => {
      const { conclusion } = classify(
        failedResult({ responseStatusCode: 200, testOutcomes: [{ name: "Check response", outcome: "failed" }] }),
      );
      expect(conclusion).toEqual({ kind: "insufficient-evidence", reason: "no-rule-matched" });
    });
  });

  describe("namesAnotherService", () => {
    it.each(["payment-service did not respond", "calling inventory_svc: refused", "billing-service: timeout", "x-svc"])(
      "matches %j",
      (text) => expect(namesAnotherService(text)).toBe(true),
    );

    it.each(["service unavailable", "servicemesh error", "-service", "upstream connect error"])("does not match %j", (text) =>
      expect(namesAnotherService(text)).toBe(false),
    );

    it("scans a very large body in linear time (target-controlled input)", () => {
      const body = "a-".repeat(500_000);
      const started = performance.now();
      expect(namesAnotherService(body)).toBe(false);
      expect(performance.now() - started).toBeLessThan(100);
    });
  });

  it("classifies every labelled evaluation case as labelled (SC-006)", () => {
    const outcomes = EVALUATION_CORPUS.map((evaluationCase) => {
      const context = matchSpecificationContext(
        evaluationCase.result,
        evaluationCase.withWorkflow ? completedWorkflow() : undefined,
        [evaluationCase.result],
        0,
      );
      const { conclusion } = classify(evaluationCase.result, context);
      return { id: evaluationCase.id, got: conclusion.kind === "likely-cause" ? conclusion.cause : "insufficient-evidence" };
    });
    expect(outcomes).toEqual(EVALUATION_CORPUS.map((evaluationCase) => ({ id: evaluationCase.id, got: evaluationCase.expected })));
  });
});
