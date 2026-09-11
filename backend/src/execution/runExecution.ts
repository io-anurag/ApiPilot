import type {
  ApiModel,
  Environment,
  NotAttemptedReason,
  PostmanRequestItem,
  RequestResult,
  TestModel,
  TestScenario,
  WorkflowExportContext,
} from "@apipilot/shared-domain";
import { generateCollection } from "../postman/generateCollection";
import { compareCodeUnits } from "../postman/ordering";
import { createLogger } from "../logger";
import { mapNewmanResult } from "./mapNewmanResult";
import { runSingleItem } from "./newmanRunner";
import { appendResult, isCancelRequested, settleRun } from "./executionRunStore";

const logger = createLogger("execution.runExecution");

export interface RunExecutionInput {
  runId: string;
  apiModel: ApiModel;
  approvedTestModel: TestModel;
  workflowContext?: WorkflowExportContext;
  environment: Environment;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Re-orders an already-built, flat list of request items (from `generateCollection()`'s own
 * folders — display-grouped and alphabetically sorted for a human browsing the download) into
 * execution order: approved-workflow steps, grouped by workflow and sorted by step position, in
 * the same workflow-id order `planApprovedWorkflows()` already uses, followed by every standalone
 * request (research.md D2). A pure re-sort over already-built items — no scenario, auth, or
 * substitution logic is recomputed, so this can never disagree with the downloadable artifact
 * about what one item's request looks like (research.md D1).
 */
function executionOrder(items: PostmanRequestItem[]): PostmanRequestItem[] {
  const workflowItems = items.filter((item) => item.provenance?.workflowId !== undefined);
  const standaloneItems = items.filter((item) => item.provenance?.workflowId === undefined);

  const byWorkflowId = new Map<string, PostmanRequestItem[]>();
  for (const item of workflowItems) {
    const workflowId = item.provenance!.workflowId!;
    const group = byWorkflowId.get(workflowId) ?? [];
    group.push(item);
    byWorkflowId.set(workflowId, group);
  }
  const orderedWorkflowIds = [...byWorkflowId.keys()].sort(compareCodeUnits);
  const orderedWorkflowItems = orderedWorkflowIds.flatMap((workflowId) =>
    [...byWorkflowId.get(workflowId)!].sort(
      (a, b) => (a.provenance!.stepPosition ?? 0) - (b.provenance!.stepPosition ?? 0),
    ),
  );
  return [...orderedWorkflowItems, ...standaloneItems];
}

/** Appends a `not-attempted` result for every item in `items`, in order (constitution XIX — every request gets an explicit outcome). */
function appendNotAttempted(
  runId: string,
  items: PostmanRequestItem[],
  scenarioById: Map<string, TestScenario>,
  reason: NotAttemptedReason,
): void {
  const nowIso = new Date().toISOString();
  for (const item of items) {
    const scenario = scenarioById.get(item.provenance?.scenarioId ?? "");
    const result: RequestResult = {
      scenarioId: scenario?.id ?? item.provenance?.scenarioId ?? "unknown",
      operationPath: scenario?.operationPath ?? "",
      operationMethod: scenario?.operationMethod ?? "",
      outcome: "not-attempted",
      notAttemptedReason: reason,
      startedAt: nowIso,
      durationMs: 0,
      assertionOutcomes: [],
    };
    appendResult(runId, result);
  }
}

/**
 * Runs every approved request for one `ExecutionRun`, strictly one at a time, against the
 * selected environment (FR-010), settling the run as `completed` or `cancelled` once every item
 * has an outcome. Never throws: any unexpected failure is caught, every unreached item is
 * recorded `not-attempted`/`"run-ended-before-reached"`, and the run still settles (constitution
 * XIX — Fail Safely). Intended to be started without being awaited by its caller
 * (research.md D4) — the caller responds to its HTTP request immediately, before this resolves.
 */
export async function runExecution(input: RunExecutionInput): Promise<void> {
  const { runId, apiModel, approvedTestModel, workflowContext, environment } = input;
  const scenarioById = new Map(approvedTestModel.scenarios.map((scenario) => [scenario.id, scenario]));
  let orderedItems: PostmanRequestItem[] = [];
  let attempted = 0;

  try {
    const outcome = generateCollection(
      apiModel,
      approvedTestModel,
      { baseUrl: environment.baseUrl, variableValues: environment.variableValues },
      workflowContext,
    );
    if (!outcome.ok) {
      // The route (execution/start) already refuses before creating a run whenever the
      // collection cannot be generated (mirrors postmanGenerationStage's own guard) — reaching
      // this is defensive only, so the run simply settles with nothing to execute.
      logger.error("execution_run_generation_refused", { runId, code: outcome.failure.code });
      settleRun(runId, "completed");
      return;
    }

    const allItems = outcome.result.collection.item.flatMap((folder) => folder.item);
    orderedItems = executionOrder(allItems);
    let environmentRecord: Record<string, string> = Object.fromEntries(
      outcome.result.environment.values.map((value) => [value.key, value.value]),
    );

    for (let index = 0; index < orderedItems.length; index += 1) {
      if (isCancelRequested(runId)) {
        appendNotAttempted(runId, orderedItems.slice(index), scenarioById, "cancelled");
        settleRun(runId, "cancelled");
        return;
      }
      if (index > 0 && environment.requestDelayMs > 0) {
        await delay(environment.requestDelayMs);
        // Re-checked after the pause too, so a cancellation requested during it takes effect
        // before the next request is dispatched rather than after (research.md D6).
        if (isCancelRequested(runId)) {
          appendNotAttempted(runId, orderedItems.slice(index), scenarioById, "cancelled");
          settleRun(runId, "cancelled");
          return;
        }
      }

      const item = orderedItems[index];
      const scenarioId = item.provenance?.scenarioId;
      const scenario = scenarioId ? scenarioById.get(scenarioId) : undefined;
      if (!scenario) {
        throw new Error(`Execution item at position ${index} carries no resolvable scenarioId.`);
      }

      const startedAt = new Date().toISOString();
      const itemOutcome = await runSingleItem({
        item,
        collectionAuth: outcome.result.collection.auth,
        declaredVariables: outcome.result.collection.variable,
        environment: environmentRecord,
      });
      environmentRecord = itemOutcome.environment;
      appendResult(runId, mapNewmanResult(scenario, itemOutcome.execution, startedAt));
      attempted = index + 1;
    }

    settleRun(runId, "completed");
  } catch (error) {
    logger.error("execution_run_error", {
      runId,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
    });
    appendNotAttempted(runId, orderedItems.slice(attempted), scenarioById, "run-ended-before-reached");
    settleRun(runId, "completed");
  }
}
