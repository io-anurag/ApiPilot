import { Router, type Response } from "express";
import type {
  AIProvider,
  ExportOptions,
  ReviewEditContent,
  ReviewUpdateRequest,
  TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import { redactSensitiveRequestValues } from "../testDesign/reviewSensitiveValues";
import { upload } from "../uploadMiddleware";
import { continueApiReview } from "../testGenerationWorkflow/apiReviewStage";
import { runAiEnhancement } from "../testGenerationWorkflow/aiEnhancementStage";
import { runDeterministicGeneration } from "../testGenerationWorkflow/deterministicGenerationStage";
import {
  EmptyApprovedScenariosError,
  PendingWorkflowDecisionsError,
  PostmanGenerationRefusedError,
  StageNotActiveError,
  UnknownWorkflowIdError,
  WorkflowInProgressError,
} from "../testGenerationWorkflow/errors";
import { runPostmanGeneration } from "../testGenerationWorkflow/postmanGenerationStage";
import {
  applyScenarioDecisions,
  editScenario,
  finalizeScenarioReview,
  regenerateScenario,
} from "../testGenerationWorkflow/scenarioReviewStage";
import { startWorkflowFromUpload } from "../testGenerationWorkflow/startWorkflow";
import { getCurrentWorkflow } from "../testGenerationWorkflow/workflowStore";
import {
  continueWorkflowReview,
  recordWorkflowDecisions,
  type WorkflowDecisionInput,
} from "../testGenerationWorkflow/workflowReviewStage";

/** Shared `409 stage_not_active` refusal, reused by every stage-transition route (FR-002). */
export function stageNotActive(res: Response, message: string): void {
  res.status(409).json({ error: "stage_not_active", message });
}

/**
 * Adds a redacted `displayRequest` alongside each review scenario's request, mirroring
 * `testScenarioReviews.ts`'s `toReviewResponse` (AP-006 FR-018) — this orchestration boundary
 * must not regress the sensitive-value redaction the underlying review endpoint already provides.
 */
function toWorkflowResponse(workflow: TestGenerationWorkflow): TestGenerationWorkflow {
  if (!workflow.reviewWorkspace) return workflow;
  return {
    ...workflow,
    reviewWorkspace: {
      ...workflow.reviewWorkspace,
      scenarios: workflow.reviewWorkspace.scenarios.map((reviewScenario) => ({
        ...reviewScenario,
        scenario: {
          ...reviewScenario.scenario,
          displayRequest: redactSensitiveRequestValues(reviewScenario.scenario.request),
        },
      })),
    },
  } as TestGenerationWorkflow;
}

function isReviewUpdateRequestArray(value: unknown): value is ReviewUpdateRequest[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).scenarioId === "string" &&
        typeof (item as Record<string, unknown>).revision === "number" &&
        ((item as Record<string, unknown>).action === "accept" ||
          (item as Record<string, unknown>).action === "reject"),
    )
  );
}

function isReviewEditContent(value: unknown): value is ReviewEditContent {
  if (typeof value !== "object" || value === null) return false;
  const edit = value as Record<string, unknown>;
  return typeof edit.request === "object" && edit.request !== null && Array.isArray(edit.assertions);
}

function isWorkflowDecisionArray(value: unknown): value is WorkflowDecisionInput[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).workflowId === "string" &&
        ((item as Record<string, unknown>).state === "approved" ||
          (item as Record<string, unknown>).state === "rejected"),
    )
  );
}

/**
 * Orchestration boundary over the existing stateless engine endpoints (contracts/
 * test-generation-workflow-api.md). Operates on the single global TestGenerationWorkflow
 * instance (FR-018) — there is at most one at a time, and no route takes an id.
 */
export function createTestGenerationWorkflowRouter(provider: AIProvider = getAIProvider()) {
  const router = Router();

  router
    .route("/test-generation-workflow")
    .get((_req, res) => {
      const workflow = getCurrentWorkflow();
      if (!workflow) {
        res.status(204).end();
        return;
      }
      res.status(200).json({ workflow: toWorkflowResponse(workflow) });
    })
    .post(upload.single("file"), async (req, res, next) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "invalid_yaml", message: "No file was uploaded under the 'file' field" });
          return;
        }
        const discardExisting = req.query.discardExisting === "true";
        const workflow = await startWorkflowFromUpload(req.file.buffer, req.file.originalname, discardExisting);
        res.status(200).json({ workflow: toWorkflowResponse(workflow) });
      } catch (err) {
        if (err instanceof WorkflowInProgressError) {
          res.status(409).json({ error: "workflow_in_progress", message: err.message });
          return;
        }
        next(err);
      }
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });

  router.post("/test-generation-workflow/api-review/continue", (_req, res) => {
    try {
      res.status(200).json({ workflow: toWorkflowResponse(continueApiReview()) });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      throw err;
    }
  });

  router.post("/test-generation-workflow/deterministic-generation", (_req, res) => {
    try {
      res.status(200).json({ workflow: toWorkflowResponse(runDeterministicGeneration()) });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      throw err;
    }
  });

  router.post("/test-generation-workflow/ai-enhancement", async (_req, res) => {
    try {
      res.status(200).json({ workflow: toWorkflowResponse(await runAiEnhancement(provider)) });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/decisions", (req, res) => {
    const updates = (req.body as Record<string, unknown> | undefined)?.updates;
    if (!isReviewUpdateRequestArray(updates)) {
      res.status(400).json({ error: "invalid_request", message: "Request must include an 'updates' array" });
      return;
    }
    try {
      const { workflow, outcomes } = applyScenarioDecisions(updates);
      res.status(200).json({ workflow: toWorkflowResponse(workflow), outcomes });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/edit", (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (
      typeof body?.scenarioId !== "string" ||
      typeof body?.revision !== "number" ||
      !isReviewEditContent(body?.edit)
    ) {
      res
        .status(400)
        .json({ error: "invalid_request", message: "Request must include scenarioId, revision, and edit" });
      return;
    }
    try {
      const { workflow, outcome } = editScenario(body.scenarioId, body.revision, body.edit);
      res.status(200).json({ workflow: toWorkflowResponse(workflow), outcome });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/regenerate", async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (typeof body?.scenarioId !== "string" || typeof body?.revision !== "number") {
      res
        .status(400)
        .json({ error: "invalid_request", message: "Request must include scenarioId and revision" });
      return;
    }
    try {
      const { workflow, outcome } = await regenerateScenario(body.scenarioId, body.revision, provider);
      res.status(200).json({ workflow: toWorkflowResponse(workflow), outcome });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/finalize", async (_req, res) => {
    try {
      res.status(200).json({ workflow: toWorkflowResponse(await finalizeScenarioReview(provider)) });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      if (err instanceof EmptyApprovedScenariosError) {
        res.status(409).json({ error: "empty_approved_scenarios", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/workflow-review/decisions", (req, res) => {
    const decisions = (req.body as Record<string, unknown> | undefined)?.decisions;
    if (!isWorkflowDecisionArray(decisions)) {
      res.status(400).json({ error: "invalid_request", message: "Request must include a 'decisions' array" });
      return;
    }
    try {
      res.status(200).json({ workflow: toWorkflowResponse(recordWorkflowDecisions(decisions)) });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      if (err instanceof UnknownWorkflowIdError) {
        res.status(400).json({ error: "unknown_workflow_id", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/workflow-review/continue", (_req, res) => {
    try {
      res.status(200).json({ workflow: toWorkflowResponse(continueWorkflowReview()) });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      if (err instanceof PendingWorkflowDecisionsError) {
        res.status(409).json({ error: "pending_workflow_decisions", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/postman-generation", (req, res) => {
    const options = (req.body as Record<string, unknown> | undefined)?.options as ExportOptions | undefined;
    try {
      res.status(200).json({ workflow: toWorkflowResponse(runPostmanGeneration(options)) });
    } catch (err) {
      if (err instanceof StageNotActiveError) return stageNotActive(res, err.message);
      if (err instanceof EmptyApprovedScenariosError) {
        res.status(409).json({ error: "empty_approved_scenarios", message: err.message });
        return;
      }
      if (err instanceof PostmanGenerationRefusedError) {
        res
          .status(err.code === "collection_validation_failed" ? 500 : 400)
          .json({ error: err.code, message: err.message, ...(err.problems ? { problems: err.problems } : {}) });
        return;
      }
      throw err;
    }
  });

  return router;
}

export const testGenerationWorkflowRouter = createTestGenerationWorkflowRouter();
