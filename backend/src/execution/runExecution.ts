import type {
  ApiModel,
  Environment,
  NotAttemptedReason,
  PostmanRequestItem,
  RequestResult,
  TestModel,
  TestScenario,
  UnmetDependency,
  WorkflowExportContext,
} from "@apipilot/shared-domain";
import { generateExecutableCollection } from "../postman/generateCollection";
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

/** A `not-attempted` result for one scenario-backed item (constitution XIX — an explicit outcome). */
function notAttemptedResult(
  scenarioId: string,
  scenario: TestScenario | undefined,
  reason: NotAttemptedReason,
  unmetDependencies?: UnmetDependency[],
): RequestResult {
  return {
    scenarioId: scenario?.id ?? scenarioId,
    operationPath: scenario?.operationPath ?? "",
    operationMethod: scenario?.operationMethod ?? "",
    outcome: "not-attempted",
    notAttemptedReason: reason,
    ...(unmetDependencies ? { unmetDependencies } : {}),
    // specs/029-execution-gap-closure FR-009: every not-attempted result was never dispatched.
    processingStage: "not-sent",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    assertionOutcomes: [],
  };
}

/**
 * A result whose data dependents must be withheld (specs/029-execution-gap-closure FR-001): any
 * failure except `"assertion-failed"`, which `mapNewmanResult` assigns only when the status check
 * passed and a schema-conformance check failed — a response that usually still carries the value
 * the hand-off needs (research.md D3).
 */
function isBlocking(result: RequestResult): boolean {
  return result.outcome === "failed" && result.failureCategory !== "assertion-failed";
}

/**
 * Appends a `not-attempted` result for every scenario-backed item in `items`, in order
 * (constitution XIX — every request gets an explicit outcome). A synthesized, non-scenario item
 * (e.g. an OAuth2 token-fetch request, AP-024) is skipped here too, consistent with its outcome
 * never being independently reported on the normal execution path either (research.md D6).
 */
function appendNotAttempted(
  runId: string,
  items: PostmanRequestItem[],
  scenarioById: Map<string, TestScenario>,
  reason: NotAttemptedReason,
): void {
  for (const item of items) {
    const scenarioId = item.provenance?.scenarioId;
    if (scenarioId === undefined) continue;
    appendResult(runId, notAttemptedResult(scenarioId, scenarioById.get(scenarioId), reason));
  }
}

/**
 * Runs every approved request for one `ExecutionRun`, strictly one at a time, against the
 * selected environment (FR-010), settling the run as `completed` or `cancelled` once every item
 * has an outcome. A request whose data dependency (an approved-workflow step or a data automatic
 * chain) had a blocking outcome is not sent: it is recorded `not-attempted`/`"dependency-not-met"`
 * naming its unmet producers (FR-018, as specified by specs/029-execution-gap-closure FR-001).
 * Cancellation is checked first, so a cancelled run never reports a dependency reason (FR-005).
 * Never throws: any unexpected failure is caught, every unreached item is
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
    const outcome = generateExecutableCollection(
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
    const { dataDependencies } = outcome;
    const scenarioIdByItemId = new Map(
      orderedItems.flatMap((item) =>
        item.provenance?.scenarioId !== undefined ? [[item.id, item.provenance.scenarioId] as const] : [],
      ),
    );
    // Item ids whose data dependents must be withheld: a blocking outcome, or itself withheld.
    const blocked = new Set<string>();

    for (let index = 0; index < orderedItems.length; index += 1) {
      if (isCancelRequested(runId)) {
        appendNotAttempted(runId, orderedItems.slice(index), scenarioById, "cancelled");
        settleRun(runId, "cancelled", "user-requested");
        return;
      }
      if (index > 0 && environment.requestDelayMs > 0) {
        await delay(environment.requestDelayMs);
        // Re-checked after the pause too, so a cancellation requested during it takes effect
        // before the next request is dispatched rather than after (research.md D6).
        if (isCancelRequested(runId)) {
          appendNotAttempted(runId, orderedItems.slice(index), scenarioById, "cancelled");
          settleRun(runId, "cancelled", "user-requested");
          return;
        }
      }

      const item = orderedItems[index];
      const scenarioId = item.provenance?.scenarioId;

      const declaredVariables = outcome.result.environment.values.map((value) => ({
        key: value.key,
        value: "",
      }));

      if (scenarioId === undefined) {
        // A synthesized, non-scenario item (e.g. an OAuth2 token-fetch request, AP-024) — the
        // only case an item legitimately carries no scenarioId. Run it for its side effect on the
        // shared environment record (e.g. capturing an access token); its own outcome is not
        // independently reported as a RequestResult — a failure surfaces via whichever dependent,
        // scenario-backed request actually needs the value it was meant to produce.
        const itemOutcome = await runSingleItem({
          item,
          collectionAuth: outcome.result.collection.auth,
          declaredVariables,
          environment: environmentRecord,
        });
        environmentRecord = itemOutcome.environment;
        attempted = index + 1;
        continue;
      }

      const scenario = scenarioById.get(scenarioId);
      if (!scenario) {
        throw new Error(`Execution item at position ${index} carries no resolvable scenarioId.`);
      }

      const unmetProducerIds = (dataDependencies.get(item.id) ?? []).filter((producerId) => blocked.has(producerId));
      if (unmetProducerIds.length > 0) {
        const unmetDependencies = unmetProducerIds.map((producerId): UnmetDependency => {
          const producer = scenarioById.get(scenarioIdByItemId.get(producerId) ?? "");
          return {
            scenarioId: producer?.id ?? scenarioIdByItemId.get(producerId) ?? "",
            operationPath: producer?.operationPath ?? "",
            operationMethod: producer?.operationMethod ?? "",
          };
        });
        appendResult(runId, notAttemptedResult(scenarioId, scenario, "dependency-not-met", unmetDependencies));
        blocked.add(item.id);
        attempted = index + 1;
        continue;
      }

      const startedAt = new Date().toISOString();
      const itemOutcome = await runSingleItem({
        item,
        collectionAuth: outcome.result.collection.auth,
        // The exported collection no longer carries its own `variable` list (the environment
        // artifact is the single source of declared names); Newman only needs the names here,
        // since real values already flow in through `environment` below.
        declaredVariables,
        environment: environmentRecord,
      });
      environmentRecord = itemOutcome.environment;
      // FR-017a: raw request/response capture is gated strictly to "local"-tier runs.
      const captureRawDetails = environment.tier === "local";
      const result = mapNewmanResult(scenario, itemOutcome.execution, startedAt, captureRawDetails);
      appendResult(runId, result);
      if (isBlocking(result)) blocked.add(item.id);
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
