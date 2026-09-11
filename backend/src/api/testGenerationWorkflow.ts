import { Router, type Response } from "express";
import type {
  AIProvider,
  EnvironmentTier,
  ExportOptions,
  ReviewEditContent,
  ReviewUpdateRequest,
  TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import { redactSensitiveRequestValues } from "../testDesign/reviewSensitiveValues";
import { upload } from "../uploadMiddleware";
import { continueApiReview } from "../testGenerationWorkflow/apiReviewStage";
import {
  createEnvironment,
  type EnvironmentInput,
  getEnvironment,
  listEnvironments,
  updateEnvironment,
} from "../execution/environmentStore";
import {
  DuplicateEnvironmentNameError,
  EnvironmentNotFoundError,
  NoRunInProgressError,
  RunNotFoundError,
} from "../execution/errors";
import {
  createRun,
  getInProgressRun,
  getRun,
  listRuns,
  requestCancel,
} from "../execution/executionRunStore";
import { missingVariableValues } from "../execution/variableCompleteness";
import { confirmationRequirement } from "../execution/destructiveOperations";
import { generateCollection } from "../postman/generateCollection";
import { runExecution } from "../execution/runExecution";
import {
  cancelAiEnhancement,
  retryAiEnhancementBatch,
  runAiEnhancement,
} from "../testGenerationWorkflow/aiEnhancementStage";
import { runDeterministicGeneration } from "../testGenerationWorkflow/deterministicGenerationStage";
import {
  AiEnhancementAlreadyRunningError,
  BatchNotFoundError,
  BatchNotRetryableError,
  EmptyApprovedScenariosError,
  NoAiEnhancementRunInProgressError,
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
import { reaffirmSession } from "../session/sessionMiddleware";
import { getSessionId } from "../session/sessionContext";
import { getStatus } from "../session/sessionRegistry";
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
 * Every Execution & Results endpoint (contracts/execution-api.md) requires the calling session's
 * `postmanGeneration` stage to be complete, since there is otherwise no approved collection to
 * execute or configure environments for. Throws `StageNotActiveError`, mapped by each route's
 * existing catch block exactly like every other stage-transition route.
 */
function requireCompletedWorkflow(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.postmanGeneration.status !== "complete") {
    throw new StageNotActiveError(
      "Execution & Results requires postmanGeneration to be complete.",
    );
  }
  return workflow;
}

const ENVIRONMENT_TIERS: ReadonlySet<string> = new Set([
  "local",
  "dev",
  "qa",
  "staging",
  "production",
]);

/** Validates and narrows a raw request body into `EnvironmentInput`, or `undefined` if invalid. */
function parseEnvironmentInput(body: unknown): EnvironmentInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) return undefined;
  if (typeof record.tier !== "string" || !ENVIRONMENT_TIERS.has(record.tier)) return undefined;
  if (typeof record.baseUrl !== "string" || record.baseUrl.trim().length === 0) return undefined;
  const variableValues = record.variableValues;
  if (variableValues !== undefined) {
    if (typeof variableValues !== "object" || variableValues === null || Array.isArray(variableValues)) {
      return undefined;
    }
    if (Object.values(variableValues as Record<string, unknown>).some((v) => typeof v !== "string")) {
      return undefined;
    }
  }
  const requestDelayMs = record.requestDelayMs;
  if (
    requestDelayMs !== undefined &&
    (typeof requestDelayMs !== "number" || !Number.isFinite(requestDelayMs) || requestDelayMs < 0)
  ) {
    return undefined;
  }
  return {
    name: record.name,
    tier: record.tier as EnvironmentTier,
    baseUrl: record.baseUrl,
    variableValues: (variableValues as Record<string, string> | undefined) ?? {},
    requestDelayMs: (requestDelayMs as number | undefined) ?? 0,
  };
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
 * test-generation-workflow-api.md). Operates on the calling session's own TestGenerationWorkflow
 * instance — there is at most one per session at a time (specs/017-session-workflow-isolation,
 * superseding spec 009's original single-process-wide-instance FR-018) — and no route takes an id.
 */
export function createTestGenerationWorkflowRouter(provider: AIProvider = getAIProvider()) {
  const router = Router();

  router
    .route("/test-generation-workflow")
    .get((req, res) => {
      const startedAt = logRequestReceived(req);
      const workflow = getCurrentWorkflow();
      if (!workflow) {
        // Distinguishes "your session's workflow was idle-evicted" from "you never started one"
        // (contracts/session-isolation.md, FR-007a) without a new endpoint.
        if (getStatus(getSessionId()) === "expired") {
          res.status(200).json({ workflow: null, sessionExpired: true });
          logRequestSucceeded(req, startedAt, 200);
          return;
        }
        res.status(204).end();
        logRequestSucceeded(req, startedAt, 204);
        return;
      }
      res.status(200).json({ workflow: toWorkflowResponse(workflow) });
      logRequestSucceeded(req, startedAt, 200);
    })
    .post(upload.single("file"), reaffirmSession, async (req, res, next) => {
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

  router.post("/test-generation-workflow/ai-enhancement", async (req, res, next) => {
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
      // Handler is async: Express 4 does not catch a rejected promise, so throwing here would
      // surface as an unhandled rejection — which terminates the process under Node's default
      // policy, discarding the entire in-memory workflow. Forward to app.ts's centralized
      // handler, which maps it to a safe 500.
      logRequestFailed(req, startedAt, 500, err instanceof Error ? err.name : "unknown_error");
      next(err);
    }
  });

  router.post("/test-generation-workflow/ai-enhancement/cancel", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      // 202 rather than 200: cancellation is accepted, not completed. The run settles at the next
      // batch boundary, and the client observes the terminal state through its existing poll —
      // responding immediately is what returns interactive control to the user promptly
      // (specs/013-ai-enhancement-viability/contracts/ai-enhancement-cancel.md).
      res.status(202).json({ workflow: toWorkflowResponse(cancelAiEnhancement()) });
      logRequestSucceeded(req, startedAt, 202);
    } catch (err) {
      if (err instanceof NoAiEnhancementRunInProgressError) {
        logRequestFailed(req, startedAt, 409, "no_run_in_progress");
        res.status(409).json({ error: "no_run_in_progress", message: err.message });
        return;
      }
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      throw err;
    }
  });

  router.post(
    "/test-generation-workflow/ai-enhancement/retry-batch",
    async (req, res, next) => {
      const startedAt = logRequestReceived(req);
      const batchIndex = (req.body as Record<string, unknown> | undefined)?.batchIndex;
      if (typeof batchIndex !== "number" || !Number.isInteger(batchIndex)) {
        logRequestFailed(req, startedAt, 400, "invalid_request");
        res.status(400).json({
          error: "invalid_request",
          message: "Request must include an integer 'batchIndex'",
        });
        return;
      }
      try {
        res.status(200).json({
          workflow: toWorkflowResponse(await retryAiEnhancementBatch(batchIndex, provider)),
        });
        logRequestSucceeded(req, startedAt, 200);
      } catch (err) {
        if (err instanceof BatchNotFoundError) {
          logRequestFailed(req, startedAt, 404, "batch_not_found");
          res.status(404).json({ error: "batch_not_found", message: err.message });
          return;
        }
        if (err instanceof BatchNotRetryableError) {
          logRequestFailed(req, startedAt, 409, "batch_not_retryable");
          res.status(409).json({ error: "batch_not_retryable", message: err.message });
          return;
        }
        if (err instanceof StageNotActiveError) {
          logRequestFailed(req, startedAt, 409, "stage_not_active");
          return stageNotActive(res, err.message);
        }
        if (err instanceof AiEnhancementAlreadyRunningError) {
          logRequestFailed(req, startedAt, 409, "ai_enhancement_already_running");
          res
            .status(409)
            .json({ error: "ai_enhancement_already_running", message: err.message });
          return;
        }
        // Handler is async: Express 4 does not catch a rejected promise, so throwing here would
        // surface as an unhandled rejection — which terminates the process under Node's default
        // policy, discarding the entire in-memory workflow. Forward to app.ts's centralized
        // handler, which maps it to a safe 500.
        logRequestFailed(req, startedAt, 500, err instanceof Error ? err.name : "unknown_error");
        next(err);
      }
    },
  );

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

  router.post("/test-generation-workflow/scenario-review/regenerate", async (req, res, next) => {
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
      // Handler is async: see the ai-enhancement route above — an uncaught throw would become
      // an unhandled rejection and terminate the process, so forward instead.
      logRequestFailed(
        req,
        startedAt,
        500,
        err instanceof Error ? err.name : "unknown_error",
        { scenarioId: body.scenarioId },
      );
      next(err);
    }
  });

  router.post("/test-generation-workflow/scenario-review/finalize", async (req, res, next) => {
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
      // Handler is async: see the ai-enhancement route above — an uncaught throw would become
      // an unhandled rejection and terminate the process, so forward instead.
      logRequestFailed(req, startedAt, 500, err instanceof Error ? err.name : "unknown_error");
      next(err);
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

  router.get("/test-generation-workflow/environments", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      requireCompletedWorkflow();
      res.status(200).json({ environments: listEnvironments() });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/environments", (req, res) => {
    const startedAt = logRequestReceived(req);
    const input = parseEnvironmentInput(req.body);
    if (!input) {
      logRequestFailed(req, startedAt, 400, "invalid_request");
      res.status(400).json({
        error: "invalid_request",
        message: "Request must include a valid 'name', 'tier', and 'baseUrl'",
      });
      return;
    }
    try {
      requireCompletedWorkflow();
      const environment = createEnvironment(input);
      res.status(200).json({ environment });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof DuplicateEnvironmentNameError) {
        logRequestFailed(req, startedAt, 409, "duplicate_environment_name");
        res.status(409).json({ error: "duplicate_environment_name", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.put("/test-generation-workflow/environments/:environmentId", (req, res) => {
    const startedAt = logRequestReceived(req);
    const input = parseEnvironmentInput(req.body);
    if (!input) {
      logRequestFailed(req, startedAt, 400, "invalid_request");
      res.status(400).json({
        error: "invalid_request",
        message: "Request must include a valid 'name', 'tier', and 'baseUrl'",
      });
      return;
    }
    try {
      requireCompletedWorkflow();
      const environment = updateEnvironment(req.params.environmentId, input);
      res.status(200).json({ environment });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof EnvironmentNotFoundError) {
        logRequestFailed(req, startedAt, 404, "environment_not_found");
        res.status(404).json({ error: "environment_not_found", message: err.message });
        return;
      }
      if (err instanceof DuplicateEnvironmentNameError) {
        logRequestFailed(req, startedAt, 409, "duplicate_environment_name");
        res.status(409).json({ error: "duplicate_environment_name", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/execution/start", (req, res) => {
    const startedAt = logRequestReceived(req);
    const body = req.body as Record<string, unknown> | undefined;
    if (typeof body?.environmentId !== "string") {
      logRequestFailed(req, startedAt, 400, "invalid_request");
      res
        .status(400)
        .json({ error: "invalid_request", message: "Request must include 'environmentId'" });
      return;
    }
    const confirmed = body?.confirmed === true;
    try {
      const workflow = requireCompletedWorkflow();

      // Checked first (FR-008): no point evaluating anything else while a run is already active.
      const inProgress = getInProgressRun();
      if (inProgress) {
        logRequestFailed(req, startedAt, 409, "execution_in_progress");
        res
          .status(409)
          .json({ error: "execution_in_progress", message: "An execution run is already in progress.", runId: inProgress.id });
        return;
      }

      const environment = getEnvironment(body.environmentId);
      const workflowContext = workflow.dependencyAnalysis
        ? {
            workflows: workflow.dependencyAnalysis.workflows,
            approvedWorkflowIds: workflow.approvedWorkflowIds ?? [],
          }
        : undefined;
      const outcome = generateCollection(
        workflow.apiModel!,
        workflow.approvedTestModel!,
        { baseUrl: environment.baseUrl, variableValues: environment.variableValues },
        workflowContext,
      );
      if (!outcome.ok) {
        const statusCode = outcome.failure.code === "empty_approved_test_model" ? 409 : 400;
        logRequestFailed(req, startedAt, statusCode, outcome.failure.code);
        res.status(statusCode).json({ error: outcome.failure.code, message: outcome.failure.message });
        return;
      }

      const missing = missingVariableValues(outcome.result.collection.variable, environment.variableValues);
      if (missing.length > 0) {
        logRequestFailed(req, startedAt, 400, "missing_variable_values");
        res.status(400).json({
          error: "missing_variable_values",
          message: `The selected environment does not supply a value for: ${missing.join(", ")}.`,
          missing,
        });
        return;
      }

      const requirement = confirmationRequirement(workflow.apiModel!, environment);
      if (requirement && !confirmed) {
        logRequestFailed(req, startedAt, 409, "confirmation_required");
        res.status(409).json({
          error: "confirmation_required",
          message: "This execution requires explicit confirmation before it can start.",
          environmentTier: requirement.environmentTier,
          destructiveOperations: requirement.destructiveOperations,
        });
        return;
      }

      const run = createRun({
        workflowId: workflow.id,
        environmentId: environment.id,
        environmentSnapshot: {
          name: environment.name,
          tier: environment.tier,
          baseUrl: environment.baseUrl,
        },
      });

      // Fire-and-poll (research.md D4): the run continues after this response is sent; the
      // client observes its progress and eventual terminal state via GET .../execution/runs/:runId.
      // runExecution() never rejects (it settles the run defensively on any internal failure), so
      // this .catch() is a defensive backstop only — see aiEnhancement's identical rationale above
      // for why an unhandled rejection here would be unsafe.
      runExecution({
        runId: run.id,
        apiModel: workflow.apiModel!,
        approvedTestModel: workflow.approvedTestModel!,
        workflowContext,
        environment,
      }).catch((error) => {
        logger.error("execution_run_unhandled_error", {
          runId: run.id,
          errorCategory: error instanceof Error ? error.name : "unknown_error",
        });
      });

      res.status(200).json({ run });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof EnvironmentNotFoundError) {
        logRequestFailed(req, startedAt, 400, "environment_not_found");
        res.status(400).json({ error: "environment_not_found", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/test-generation-workflow/execution/cancel", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      requireCompletedWorkflow();
      const inProgress = getInProgressRun();
      if (!inProgress) {
        throw new NoRunInProgressError();
      }
      const run = requestCancel(inProgress.id);
      // 202: cancellation is accepted, not completed instantly — the in-flight request finishes,
      // then the run settles as cancelled, observable via the existing poll (research.md D6,
      // mirroring the existing ai-enhancement/cancel convention).
      res.status(202).json({ run });
      logRequestSucceeded(req, startedAt, 202);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof NoRunInProgressError) {
        logRequestFailed(req, startedAt, 409, "no_run_in_progress");
        res.status(409).json({ error: "no_run_in_progress", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/test-generation-workflow/execution/runs", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      requireCompletedWorkflow();
      // Summaries only (no `results`), newest first — listRuns() already orders newest first.
      const runs = listRuns().map(({ results: _results, ...summary }) => summary);
      res.status(200).json({ runs });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      throw err;
    }
  });

  router.get("/test-generation-workflow/execution/runs/:runId", (req, res) => {
    const startedAt = logRequestReceived(req);
    try {
      requireCompletedWorkflow();
      const run = getRun(req.params.runId);
      res.status(200).json({ run });
      logRequestSucceeded(req, startedAt, 200);
    } catch (err) {
      if (err instanceof StageNotActiveError) {
        logRequestFailed(req, startedAt, 409, "stage_not_active");
        return stageNotActive(res, err.message);
      }
      if (err instanceof RunNotFoundError) {
        logRequestFailed(req, startedAt, 404, "run_not_found");
        res.status(404).json({ error: "run_not_found", message: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}

/** Default router instance wired to the process-wide AI provider (see `getAIProvider`). */
export const testGenerationWorkflowRouter = createTestGenerationWorkflowRouter();
