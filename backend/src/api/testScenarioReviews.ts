import { Router } from "express";
import type {
  ApiModel,
  ReviewEditContent,
  ReviewWorkspace,
  ReviewWorkspaceSnapshot,
  TestModel,
} from "@apipilot/shared-domain";
import { getAIProvider } from "../ai";
import {
  applyRegeneratedScenario,
  applyReviewEdit,
  applyReviewUpdates,
  beginRegeneration,
  hydrateReviewWorkspace,
  projectApprovedTestModel,
  regenerationFailureOutcome,
} from "../testDesign/reviewTestModel";
import { regenerateReviewScenario } from "../testDesign/regenerateReviewScenario";
import { redactSensitiveRequestValues } from "../testDesign/reviewSensitiveValues";
import { createLogger } from "../logger";

const logger = createLogger("api.testScenarioReviews");

/** Logs a request-received event and returns the start timestamp used to compute `durationMs` later. */
function logRequestReceived(req: { method: string; path: string }): number {
  logger.info("request_received", { method: req.method, path: req.path });
  return Date.now();
}

/** Logs a request-succeeded (statusCode < 400) or request-failed event with duration and, on failure, an error category. */
function logRequestOutcome(
  req: { method: string; path: string },
  startedAt: number,
  statusCode: number,
  extra: { scenarioId?: string; errorCategory?: string } = {},
): void {
  const fields = {
    method: req.method,
    path: req.path,
    statusCode,
    durationMs: Date.now() - startedAt,
    ...extra,
  };
  if (statusCode >= 400) logger.error("request_failed", fields);
  else logger.info("request_succeeded", fields);
}

/**
 * Adds a redacted `displayRequest` alongside each scenario's request for safe rendering,
 * without altering the round-trippable `scenario.request` used for hydration and the
 * approved TestModel projection (FR-018, data-model.md: sensitive values redacted at display).
 */
function toReviewResponse(workspace: ReviewWorkspace) {
  return {
    ...workspace,
    scenarios: workspace.scenarios.map((reviewScenario) => ({
      ...reviewScenario,
      scenario: {
        ...reviewScenario.scenario,
        displayRequest: redactSensitiveRequestValues(reviewScenario.scenario.request),
      },
    })),
  };
}

function isApiModel(value: unknown): value is ApiModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Record<string, unknown>;
  const summary = model.summary as Record<string, unknown> | null | undefined;
  return (
    Array.isArray(model.operations) &&
    typeof model.securitySchemes === "object" &&
    model.securitySchemes !== null &&
    typeof summary === "object" &&
    summary !== null &&
    Array.isArray(summary.issues)
  );
}

function isTestModel(value: unknown): value is TestModel {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).scenarios)
  );
}

function isReviewWorkspaceSnapshot(
  value: unknown,
): value is ReviewWorkspaceSnapshot | undefined {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.workspaceRevision === "number" && Array.isArray(snapshot.scenarios)
  );
}

interface ReviewRequestBody {
  apiModel: ApiModel;
  testModel: TestModel;
  review?: {
    workspaceRevision?: number;
    scenarios?: ReviewWorkspaceSnapshot["scenarios"];
    updates?: {
      scenarioId: string;
      revision: number;
      action: "accept" | "reject";
      reason?: string;
      actor?: string;
    }[];
  };
}

function isReviewRequestBody(value: unknown): value is ReviewRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (!isApiModel(body.apiModel) || !isTestModel(body.testModel)) return false;
  if (body.review === undefined) return true;
  if (typeof body.review !== "object" || body.review === null) return false;
  const review = body.review as Record<string, unknown>;
  if (review.updates !== undefined && !Array.isArray(review.updates)) return false;
  if (review.scenarios !== undefined && !Array.isArray(review.scenarios)) return false;
  return true;
}

function toSnapshot(
  review: ReviewRequestBody["review"],
): ReviewWorkspaceSnapshot | undefined {
  if (!review?.scenarios) return undefined;
  return {
    workspaceRevision: review.workspaceRevision ?? 0,
    scenarios: review.scenarios,
  };
}

function invalidRequest(message: string) {
  return { error: "invalid_test_scenario_review_request", message };
}

function statusForOutcome(outcome: { finding?: { code: string } }): number {
  return outcome.finding?.code === "stale-revision" ? 409 : 200;
}

interface ScenarioActionBody {
  apiModel: ApiModel;
  testModel: TestModel;
  review?: ReviewWorkspaceSnapshot;
  scenarioId: string;
  revision: number;
  edit?: unknown;
}

function isScenarioActionBody(value: unknown): value is ScenarioActionBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    isApiModel(body.apiModel) &&
    isTestModel(body.testModel) &&
    typeof body.scenarioId === "string" &&
    body.scenarioId.trim().length > 0 &&
    typeof body.revision === "number" &&
    isReviewWorkspaceSnapshot(body.review)
  );
}

function isReviewEditContent(value: unknown): value is ReviewEditContent {
  if (typeof value !== "object" || value === null) return false;
  const edit = value as Record<string, unknown>;
  return (
    typeof edit.request === "object" &&
    edit.request !== null &&
    Array.isArray(edit.assertions)
  );
}

/** Builds the routers for the scenario-review workspace endpoints (bulk update, single-scenario edit, regenerate); `provider` defaults to the process-wide AI provider but can be injected for testing. */
export function createTestScenarioReviewsRouter(provider = getAIProvider()) {
  const router = Router();

  router
    .route("/test-models/reviews")
    .post((req, res) => {
      const startedAt = logRequestReceived(req);
      if (!isReviewRequestBody(req.body)) {
        logRequestOutcome(req, startedAt, 400, {
          errorCategory: "invalid_test_scenario_review_request",
        });
        res
          .status(400)
          .json(
            invalidRequest(
              "Request must include apiModel.operations and testModel.scenarios arrays",
            ),
          );
        return;
      }
      const workspace = hydrateReviewWorkspace(
        req.body.testModel,
        toSnapshot(req.body.review),
      );
      const { workspace: next, outcomes } = applyReviewUpdates(
        workspace,
        req.body.review?.updates ?? [],
      );
      res.status(200).json({
        review: toReviewResponse(next),
        approvedTestModel: projectApprovedTestModel(next),
        outcomes,
      });
      logRequestOutcome(req, startedAt, 200);
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });

  router
    .route("/test-models/reviews/edit")
    .post((req, res) => {
      const startedAt = logRequestReceived(req);
      if (!isScenarioActionBody(req.body) || !isReviewEditContent(req.body.edit)) {
        logRequestOutcome(req, startedAt, 400, {
          errorCategory: "invalid_test_scenario_review_request",
        });
        res
          .status(400)
          .json(
            invalidRequest(
              "Request must include apiModel, testModel, scenarioId, revision, and a supported edit",
            ),
          );
        return;
      }
      const workspace = hydrateReviewWorkspace(req.body.testModel, req.body.review);
      const { workspace: next, outcome } = applyReviewEdit(
        workspace,
        req.body.apiModel,
        req.body.scenarioId,
        req.body.revision,
        req.body.edit,
      );
      const statusCode = statusForOutcome(outcome);
      res.status(statusCode).json({
        review: toReviewResponse(next),
        approvedTestModel: projectApprovedTestModel(next),
        outcomes: [outcome],
      });
      logRequestOutcome(req, startedAt, statusCode, {
        scenarioId: req.body.scenarioId,
        ...(statusCode >= 400 ? { errorCategory: outcome.finding?.code } : {}),
      });
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });

  router
    .route("/test-models/reviews/regenerate")
    .post(async (req, res) => {
      const startedAt = logRequestReceived(req);
      if (!isScenarioActionBody(req.body)) {
        logRequestOutcome(req, startedAt, 400, {
          errorCategory: "invalid_test_scenario_review_request",
        });
        res
          .status(400)
          .json(
            invalidRequest(
              "Request must include apiModel, testModel, scenarioId, and revision",
            ),
          );
        return;
      }
      const workspace = hydrateReviewWorkspace(req.body.testModel, req.body.review);
      const started = beginRegeneration(
        workspace,
        req.body.scenarioId,
        req.body.revision,
      );
      if ("error" in started) {
        const statusCode = statusForOutcome(started.error);
        res.status(statusCode).json({
          review: toReviewResponse(workspace),
          approvedTestModel: projectApprovedTestModel(workspace),
          outcomes: [started.error],
        });
        logRequestOutcome(req, startedAt, statusCode, {
          scenarioId: req.body.scenarioId,
          ...(statusCode >= 400 ? { errorCategory: started.error.finding?.code } : {}),
        });
        return;
      }
      const result = await regenerateReviewScenario(
        req.body.apiModel,
        started.existing,
        provider,
      );
      if (!result.ok) {
        res.status(200).json({
          review: toReviewResponse(workspace),
          approvedTestModel: projectApprovedTestModel(workspace),
          outcomes: [regenerationFailureOutcome(started.existing, result.message)],
        });
        logRequestOutcome(req, startedAt, 200, { scenarioId: req.body.scenarioId });
        return;
      }
      const { workspace: next, outcome } = applyRegeneratedScenario(
        workspace,
        req.body.scenarioId,
        result.scenario,
      );
      res.status(200).json({
        review: toReviewResponse(next),
        approvedTestModel: projectApprovedTestModel(next),
        outcomes: [outcome],
      });
      logRequestOutcome(req, startedAt, 200, { scenarioId: req.body.scenarioId });
    })
    .all((_req, res) => {
      res.status(405).json({ error: "method_not_allowed" });
    });

  return router;
}

/** Default router instance wired to the process-wide AI provider (see `getAIProvider`). */
export const testScenarioReviewsRouter = createTestScenarioReviewsRouter();
