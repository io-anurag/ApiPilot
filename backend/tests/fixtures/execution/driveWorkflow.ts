import request from "supertest";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import {
  VALID_SPECIFICATION_FILENAME,
  validSpecificationBuffer,
} from "../testGenerationWorkflow/workflowFixtures";

/**
 * Drives a fresh `supertest` agent through the full guided workflow (upload -> ... ->
 * postmanGeneration complete) using the three-operation Pet Store fixture
 * (`workflowFixtures.ts`), accepting every scenario and approving every discovered workflow along
 * the way. Every execution test (Phase 3 onward) needs a `postmanGeneration`-complete workflow as
 * its own precondition — this is shared setup, not the thing under test.
 */
export async function driveToPostmanGenerationComplete(
  agent: ReturnType<typeof request.agent>,
): Promise<TestGenerationWorkflow> {
  await agent
    .post("/api/test-generation-workflow")
    .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
  await agent.post("/api/test-generation-workflow/api-review/continue");
  await agent.post("/api/test-generation-workflow/deterministic-generation");
  const afterEnhancement = await agent.post("/api/test-generation-workflow/ai-enhancement");

  const scenarios: { scenarioId: string; revision: number }[] =
    afterEnhancement.body.workflow.reviewWorkspace.scenarios.map(
      (s: { scenarioId: string; revision: number }) => ({
        scenarioId: s.scenarioId,
        revision: s.revision,
      }),
    );
  await agent
    .post("/api/test-generation-workflow/scenario-review/decisions")
    .send({ updates: scenarios.map((s) => ({ ...s, action: "accept" })) });

  const afterFinalize = await agent.post("/api/test-generation-workflow/scenario-review/finalize");
  let workflow: TestGenerationWorkflow = afterFinalize.body.workflow;

  if (workflow.stages.workflowReview.status === "active") {
    const discovered = workflow.dependencyAnalysis?.workflows ?? [];
    if (discovered.length > 0) {
      await agent
        .post("/api/test-generation-workflow/workflow-review/decisions")
        .send({ decisions: discovered.map((w) => ({ workflowId: w.id, state: "approved" })) });
    }
    const afterWorkflowReview = await agent.post(
      "/api/test-generation-workflow/workflow-review/continue",
    );
    workflow = afterWorkflowReview.body.workflow;
  }

  const afterPostman = await agent
    .post("/api/test-generation-workflow/postman-generation")
    .send({ options: {} });
  return afterPostman.body.workflow;
}
