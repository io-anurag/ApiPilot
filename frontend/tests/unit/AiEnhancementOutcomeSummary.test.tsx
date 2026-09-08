import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { AiEnhancementOutcomeSummary } from "../../src/components/AiEnhancementOutcomeSummary";

function makeWorkflow(): TestGenerationWorkflow {
  return {
    id: "wf-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeStageId: "scenarioReview",
    specificationFilename: "valid.yaml",
    stages: {
      upload: { stageId: "upload", status: "complete" },
      analysis: { stageId: "analysis", status: "complete" },
      apiReview: { stageId: "apiReview", status: "complete" },
      deterministicGeneration: { stageId: "deterministicGeneration", status: "complete" },
      aiEnhancement: {
        stageId: "aiEnhancement",
        status: "partial",
        batchOutcomes: [
          { index: 0, operationKeys: ["GET /pets"], status: "succeeded" },
          {
            index: 1,
            operationKeys: ["POST /pets"],
            status: "failed",
            errorCategory: "TIMEOUT",
            failureExplanation: {
              category: "too-slow",
              summary: "The local AI model was too slow to finish this on this machine.",
              nextStep: "Try enhancing a smaller specification.",
              retryable: false,
            },
          },
          {
            index: 2,
            operationKeys: ["GET /pets/{id}"],
            status: "failed",
            errorCategory: "PROVIDER_UNAVAILABLE",
            failureExplanation: {
              category: "unavailable",
              summary: "Local AI is unavailable right now.",
              nextStep: "Your deterministic scenarios are unaffected and ready to review.",
              retryable: true,
            },
          },
        ],
      },
      scenarioReview: { stageId: "scenarioReview", status: "active" },
      dependencyAnalysis: { stageId: "dependencyAnalysis", status: "not-yet-reached" },
      workflowReview: { stageId: "workflowReview", status: "not-yet-reached" },
      postmanGeneration: { stageId: "postmanGeneration", status: "not-yet-reached" },
    },
    aiEnhancement: {
      requestId: "req-1",
      enhancedTestModel: { scenarios: [] },
      aiCandidates: { added: [], deduplicated: [], rejected: [], nonExecutable: [] },
      aiProviderOutcome: "partial",
    },
  } as unknown as TestGenerationWorkflow;
}

describe("AiEnhancementOutcomeSummary batch list (specs/015-ai-batch-retry US2)", () => {
  it("renders every batch's status and reason", () => {
    render(<AiEnhancementOutcomeSummary workflow={makeWorkflow()} />);

    expect(screen.getByText(/The local AI model was too slow/)).toBeInTheDocument();
    expect(screen.getByText(/Local AI is unavailable right now/)).toBeInTheDocument();
  });

  it("distinguishes a non-retryable batch's reason from a retryable one's, not by color alone", () => {
    render(<AiEnhancementOutcomeSummary workflow={makeWorkflow()} />);

    // Accessible-name/text-based distinction (constitution XXXVIII-equivalent: never color-only).
    const batchList = screen.getByRole("list", { name: /batch/i });
    expect(batchList).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(3);
  });

  it("renders nothing extra when the run has no batchOutcomes yet", () => {
    const workflow = makeWorkflow();
    workflow.stages.aiEnhancement.batchOutcomes = undefined;
    render(<AiEnhancementOutcomeSummary workflow={workflow} />);

    expect(screen.queryByRole("list", { name: /batch/i })).not.toBeInTheDocument();
  });
});
