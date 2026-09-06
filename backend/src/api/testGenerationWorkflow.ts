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
  AiEnhancementAlreadyRunningError,
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
import { createLogger } from "../logger";

const logger = createLogger("api.testGenerationWorkflow");

/** Minimal request shape the logging helpers below need — `Request` narrowed to avoid importing it solely for typing. */
interface LoggableRequest {
  method: string;
  path: string;
}

/** Logs a request-received event and returns the start timestamp used to compute `durationMs` for the matching outcome log. */
function logRequestReceived(req: LoggableRequest): number {
  logger.info("request_received", { method: req.method, path: req.path });
  return Date.now();
}

/** Logs a request-succeeded event alongside the response status code and duration. */
function logRequestSucceeded(
  req: LoggableRequest,
  startedAt: number,
  statusCode: number,
  extra: { scenarioId?: string } = {},
): void {
  logger.info("request_succeeded", {
    method: req.method,
    path: req.path,
    statusCode,
    durationMs: Date.now() - startedAt,
    ...extra,
  });
}

/** Logs a request-failed event with the response status code, a non-sensitive error category, and duration. */
function logRequestFailed(
  req: LoggableRequest,
  startedAt: number,
  statusCode: number,
  errorCategory: string,
  extra: { scenarioId?: string } = {},
): void {
  logger.error("request_failed", {
    method: req.method,
    path: req.path,
    statusCode,
    errorCategory,
    durationMs: Date.now() - startedAt,
    ...extra,
  });
}

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
    .get((req, res) => {
      const startedAt = logRequestReceived(req);
      const workflow = getCurrentWorkflow();
      if (!workflow) {
        res.status(204).end();
        logRequestSucceeded(req, startedAt, 204);
        return;
      }
      res.status(200).json({ workflow: toWorkflowResponse(workflow) });
      logRequestSucceeded(req, startedAt, 200);
    })
    .post(upload.single("file"), async (req, res, next) => {
      const startedAt = logRequestReceived(req);
      try {
        if (!req.file) {
          logRequestFailed(req, startedAt, 400, "invalid_yaml");
          res.status(400).json({ error: "invalid_yaml", message: "No file was uploaded under the 'file' field" });
          return;
        }
        const discardExisting = req.query.discardExisting === "true";
        const workflow = await startWorkflowFromUpload(req.file.buffer, req.file.originalname, discardExisting);
        res.status(200).json({ workflow: toWorkflowResponse(workflow) });
        logRequestSucceeded(req, startedAt, 200);
      } catch (err) {
        if (err instanceof WorkflowInProgressError) {
          logRequestFailed(req, startedAt, 409, "workflow_in_progress");
          res.status(409).json({ error: "workflow_in_progress", message: err.message });
          return;
        }
        // Forwarded to app.ts's centralized error handler, which logs this generically —
        // not duplicated here.
        next(err);
      }
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });

  router.post("/test-generation-workflow/api-review/continue", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      res.status(200).json({ workflow: toWorkflowResponse(continueApiReview()) });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      // Synchronous throw: Express forwards this to app.ts's centralized error handler,
      // which logs it generically — not duplicated here.
      throw err;
    }
  });

  router.post("/test-generation-workflow/deterministic-generation", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      res.status(200).json({ workflow: toWorkflowResponse(runDeterministicGeneration()) });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/ai-enhancement", async (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      res.status(200).json({ workflow: toWorkflowResponse(await runAiEnhancement(provider)) });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof AiEnhancementAlreadyRunningError) {
        logRequestFailed(req, startedAt, 409, "ai_enhancement_already_running");
        res.status(409).json({ error: "ai_enhancement_already_running", message: err.message });
        return;
      }
      // Handler is async: an uncaught throw here becomes a rejected promise that Express 4
      // does not forward to the error middleware (pre-existing behavior of this route, not
      // changed here) — log it explicitly so it is not silently invisible.
      logRequestFailed(req, startedAt, 500, err instanceof Error ? err.name : "unknown_error");
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/decisions", (req, res) => {
    const startedAt = logRequestReceived(req);
    const updates = (req.body as Record<string, unknown> | undefined)?.updates;
    if (!isReviewUpdateRequestArray(updates)) {
      logRequestFailed(req, startedAt, 400, "invalid_request");
      res.status(400).json({ error: "invalid_request", message: "Request must include an 'updates' array" });
      return;
    }
    try {
      const { workflow, outcomes } = applyScenarioDecisions(updates);
      res.status(200).json({ workflow: toWorkflowResponse(workflow), outcomes });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/edit", (req, res) => {
    const startedAt = logRequestReceived(req);
    const body = req.body as Record<string, unknown> | undefined;
    if (
      typeof body?.scenarioId !== "string" ||
      typeof body?.revision !== "number" ||
      !isReviewEditContent(body?.edit)
    ) {
      logRequestFailed(req, startedAt, 400, "invalid_request");
      res
        .status(400)
        .json({ error: "invalid_request", message: "Request must include scenarioId, revision, and edit" });
      return;
    }
    try {
      const { workflow, outcome } = editScenario(body.scenarioId, body.revision, body.edit);
      res.status(200).json({ workflow: toWorkflowResponse(workflow), outcome });
      logRequestSucceeded(req, startedAt, 200, { scenarioId: body.scenarioId });
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active", { scenarioId: body.scenarioId });
        return stageNotActive(res, err.message);
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/regenerate", async (req, res) => {
    const startedAt = logRequestReceived(req);
    const body = req.body as Record<string, unknown> | undefined;
    if (typeof body?.scenarioId !== "string" || typeof body?.revision !== "number") {
      logRequestFailed(req, startedAt, 400, "invalid_request");
      res
        .status(400)
        .json({ error: "invalid_request", message: "Request must include scenarioId and revision" });
      return;
    }
    try {
      const { workflow, outcome } = await regenerateScenario(body.scenarioId, body.revision, provider);
      res.status(200).json({ workflow: toWorkflowResponse(workflow), outcome });
      logRequestSucceeded(req, startedAt, 200, { scenarioId: body.scenarioId });
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active", { scenarioId: body.scenarioId });
        return stageNotActive(res, err.message);
      }
      // Handler is async: an uncaught throw here becomes a rejected promise that Express 4
      // does not forward to the error middleware (pre-existing behavior of this route, not
      // changed here) — log it explicitly so it is not silently invisible.
      logRequestFailed(
        req,
        startedAt,
        500,
        err instanceof Error ? err.name : "unknown_error",
        { scenarioId: body.scenarioId },
      );
      throw err;
    }
  });

  router.post("/test-generation-workflow/scenario-review/finalize", async (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      res.status(200).json({ workflow: toWorkflowResponse(await finalizeScenarioReview(provider)) });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof EmptyApprovedScenariosError) {
        logRequestFailed(req, startedAt, 409, "empty_approved_scenarios");
        res.status(409).json({ error: "empty_approved_scenarios", message: err.message });
        return;
      }
      // Handler is async: an uncaught throw here becomes a rejected promise that Express 4
      // does not forward to the error middleware (pre-existing behavior of this route, not
      // changed here) — log it explicitly so it is not silently invisible.
      logRequestFailed(req, startedAt, 500, err instanceof Error ? err.name : "unknown_error");
      throw err;
    }
  });

  router.post("/test-generation-workflow/workflow-review/decisions", (req, res) => {
    const startedAt = logRequestReceived(req);
    const decisions = (req.body as Record<string, unknown> | undefined)?.decisions;
    if (!isWorkflowDecisionArray(decisions)) {
      logRequestFailed(req, startedAt, 400, "invalid_request");
      res.status(400).json({ error: "invalid_request", message: "Request must include a 'decisions' array" });
      return;
    }
    try {
      res.status(200).json({ workflow: toWorkflowResponse(recordWorkflowDecisions(decisions)) });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof UnknownWorkflowIdError) {
        logRequestFailed(req, startedAt, 400, "unknown_workflow_id");
        res.status(400).json({ error: "unknown_workflow_id", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/workflow-review/continue", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      res.status(200).json({ workflow: toWorkflowResponse(continueWorkflowReview()) });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof PendingWorkflowDecisionsError) {
        logRequestFailed(req, startedAt, 409, "pending_workflow_decisions");
        res.status(409).json({ error: "pending_workflow_decisions", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/postman-generation", (req, res) => {
    const startedAt = logRequestReceived(req);
    const options = (req.body as Record<string, unknown> | undefined)?.options as ExportOptions | undefined;
    try {
      res.status(200).json({ workflow: toWorkflowResponse(runPostmanGeneration(options)) });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof EmptyApprovedScenariosError) {
        logRequestFailed(req, startedAt, 409, "empty_approved_scenarios");
        res.status(409).json({ error: "empty_approved_scenarios", message: err.message });
        return;
      }
      if (err instanceof PostmanGenerationRefusedError) {
        const statusCode = err.code === "collection_validation_failed" ? 500 : 400;
        logRequestFailed(req, startedAt, statusCode, err.code);
        res
          .status(statusCode)
          .json({ error: err.code, message: err.message, ...(err.problems ? { problems: err.problems } : {}) });
        return;
      }
      throw err;
    }
  });

  return router;
}

/** Default router instance wired to the process-wide AI provider (see `getAIProvider`). */
export const testGenerationWorkflowRouter = createTestGenerationWorkflowRouter();
