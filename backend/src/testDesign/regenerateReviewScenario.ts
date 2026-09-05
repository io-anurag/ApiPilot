import { createHash } from "node:crypto";
import type {
  AIProvider,
  ApiModel,
  ReviewScenario,
  TestScenario,
} from "@apipilot/shared-domain";
import { buildAIScenarioRequest } from "./aiScenarioPrompt";
import { isCandidateShape, parseAIScenarioResponse } from "./parseAIScenarioResponse";
import {
  validateAICandidateSemantics,
  validateAICandidateShape,
} from "./validateAICandidate";
import { candidateToScenario } from "./aiScenarioCandidate";
import { createLogger } from "../logger";

const logger = createLogger("testDesign.regenerateReviewScenario");

/** Outcome of one regeneration attempt: either the AI-derived replacement, or a non-throwing failure with a display message (never partial). */
export type RegenerationResult =
  { ok: true; scenario: TestScenario } | { ok: false; message: string };

/**
 * Requests a single AI replacement for one AI-derived scenario through the AIProvider boundary,
 * reusing the same structural and semantic validation as initial AI scenario suggestions
 * (FR-015, FR-016). Never mutates the current scenario; failures are reported without a
 * replacement so the caller can preserve the last valid state.
 */
export async function regenerateReviewScenario(
  apiModel: ApiModel,
  reviewScenario: ReviewScenario,
  provider: AIProvider,
): Promise<RegenerationResult> {
  const result = await attemptRegeneration(apiModel, reviewScenario, provider);
  logger.info("regeneration_resolved", {
    scenarioId: reviewScenario.scenarioId,
    outcome: result.ok ? "success" : "failure",
  });
  return result;
}

async function attemptRegeneration(
  apiModel: ApiModel,
  reviewScenario: ReviewScenario,
  provider: AIProvider,
): Promise<RegenerationResult> {
  const operation = apiModel.operations.find(
    (item) =>
      item.path === reviewScenario.scenario.operationPath &&
      item.method.toUpperCase() === reviewScenario.scenario.operationMethod.toUpperCase(),
  );
  if (!operation) {
    return {
      ok: false,
      message: "Scenario operation is not defined in the supplied ApiModel",
    };
  }
  const requestId = `regenerate-${createHash("sha256")
    .update(`${reviewScenario.scenarioId}:${reviewScenario.revision}`)
    .digest("hex")
    .slice(0, 24)}`;
  const contextTestModel = { scenarios: [reviewScenario.scenario] };
  try {
    const response = await provider.infer(
      buildAIScenarioRequest(requestId, apiModel, contextTestModel),
    );
    const parsed = parseAIScenarioResponse(response);
    const rawCandidate = parsed.candidates[0];
    if (!rawCandidate) {
      return { ok: false, message: "AI provider returned no replacement candidate" };
    }
    const shapeFindings = validateAICandidateShape(rawCandidate);
    if (shapeFindings.length > 0 || !isCandidateShape(rawCandidate)) {
      return {
        ok: false,
        message: "AI provider returned a malformed replacement candidate",
      };
    }
    const semanticFindings = validateAICandidateSemantics(rawCandidate, apiModel);
    if (semanticFindings.length > 0) {
      return {
        ok: false,
        message: "AI provider returned an unsupported replacement candidate",
      };
    }
    return {
      ok: true,
      scenario: candidateToScenario(
        rawCandidate,
        operation,
        response.modelId,
        response.provider,
      ),
    };
  } catch (error) {
    const category =
      error &&
      typeof error === "object" &&
      "category" in error &&
      typeof error.category === "string"
        ? error.category
        : "INVALID_RESPONSE";
    return { ok: false, message: regenerationErrorMessage(category) };
  }
}

function regenerationErrorMessage(category: string): string {
  if (category === "TIMEOUT") {
    return "AI provider timed out; the current scenario was preserved";
  }
  if (["PROVIDER_UNAVAILABLE", "NOT_READY", "LOAD_FAILED"].includes(category)) {
    return "AI provider is unavailable; the current scenario was preserved";
  }
  return "AI provider returned invalid output; the current scenario was preserved";
}
