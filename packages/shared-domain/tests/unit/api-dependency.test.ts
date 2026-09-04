import { describe, expect, it } from "vitest";
import type {
  ApiDependencyRelationship,
  DependencyAnalysisResult,
  DependencyCycleFinding,
  IntegrationWorkflow,
  ManualConfirmationCandidate,
} from "../../src/apiDependency";

describe("api dependency contracts", () => {
  it("types a deterministic relationship with its evidence and a non-empty explanation", () => {
    const relationship: ApiDependencyRelationship = {
      id: "rel-1",
      producer: { operationPath: "/users", operationMethod: "POST", field: "id" },
      consumer: {
        operationPath: "/users/{userId}",
        operationMethod: "GET",
        field: "userId",
        location: "path",
      },
      confidence: "CONFIRMED",
      source: "deterministic",
      evidence: {
        nameMatch: true,
        typeMatch: true,
        formatMatch: true,
        resourceRelationship: true,
        tagAlignment: true,
      },
      explanation: "POST /users returns 'id'; GET /users/{userId} consumes it as path parameter 'userId'.",
    };
    expect(relationship.confidence).toBe("CONFIRMED");
    expect(relationship.explanation.length).toBeGreaterThan(0);
  });

  it("types an AI-derived relationship that never exceeds LIKELY and carries corroboration", () => {
    const relationship: ApiDependencyRelationship = {
      id: "rel-2",
      producer: { operationPath: "/accounts", operationMethod: "POST", field: "accountId" },
      consumer: {
        operationPath: "/transfers",
        operationMethod: "POST",
        field: "accountRef",
        location: "body",
      },
      confidence: "LIKELY",
      source: "ai",
      aiCorroboration: {
        aiModel: "mock-provider",
        aiProvider: "mock",
        aiConfidence: 0.9,
        aiRationale: "accountRef semantically refers to the account identifier.",
      },
      explanation: "AI-suggested: accountRef is inferred to reference accountId.",
    };
    expect(relationship.confidence).not.toBe("CONFIRMED");
    expect(relationship.aiCorroboration?.aiModel).toBe("mock-provider");
  });

  it("types an ordered workflow whose variables trace back to a relationship", () => {
    const workflow: IntegrationWorkflow = {
      id: "wf-1",
      steps: [
        {
          position: 0,
          operationPath: "/users",
          operationMethod: "POST",
          producesVariableNames: ["userId"],
          consumesVariableNames: [],
        },
        {
          position: 1,
          operationPath: "/users/{userId}",
          operationMethod: "GET",
          producesVariableNames: [],
          consumesVariableNames: ["userId"],
        },
      ],
      variables: [
        {
          name: "userId",
          producerStepIndex: 0,
          producerField: "id",
          consumerStepIndex: 1,
          consumerLocation: "path",
          consumerField: "userId",
          relationshipId: "rel-1",
        },
      ],
      relationshipIds: ["rel-1"],
    };
    expect(workflow.variables[0].producerStepIndex).toBeLessThan(workflow.variables[0].consumerStepIndex);
  });

  it("types a manual confirmation candidate and a cycle finding", () => {
    const candidate: ManualConfirmationCandidate = {
      relationshipId: "rel-3",
      reason: "possible-confidence",
      message: "Field name matches with no other supporting evidence.",
    };
    const cycle: DependencyCycleFinding = {
      relationshipIds: ["rel-4", "rel-5"],
      operations: [
        { path: "/widgets", method: "POST" },
        { path: "/gadgets", method: "POST" },
      ],
      message: "widgets and gadgets depend on each other.",
    };
    expect(candidate.reason).toBe("possible-confidence");
    expect(cycle.operations).toHaveLength(2);
  });

  it("types a full analysis result with an explicit AI outcome", () => {
    const result: DependencyAnalysisResult = {
      requestId: "dep-1",
      graph: { relationships: [] },
      workflows: [],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    };
    expect(result.aiOutcome).toBe("skipped");
  });
});
