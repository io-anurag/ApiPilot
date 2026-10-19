import type {
  EnvironmentTier,
  RunLimits,
  ScenarioOutcomeKind,
  ScenarioResult,
  SecurityProfile,
  SecurityRun,
  ApiModel,
} from "@apipilot/shared-domain";
import { createLogger } from "../../logger";
import type { SecurityEvidenceRepository } from "../../persistence/securityEvidenceRepository";
import type { SecurityFindingRepository } from "../../persistence/securityFindingRepository";
import type { SecurityRunRepository } from "../../persistence/securityRunRepository";
import type { SecurityScenarioRepository } from "../../persistence/securityScenarioRepository";
import { basicObservedSummary } from "../evaluation/pendingEvaluator";
import type { Evaluator, ExecutedResponse } from "../evaluation/types";
import { buildEvidenceRecord } from "../evidence/redactEvidence";
import { SYSTEM_ACTOR, recordFailure, recordPass, type FindingContext } from "../findings/findingService";
import { buildSecurityRequest, type CredentialLookup } from "./buildSecurityRequest";
import { planCleanup, runCleanup, type CreatedResource } from "./cleanup";
import type { DestinationPolicy } from "./destinationPolicy";
import { describeBlock } from "./guardedSender";
import type { PlannedExecution } from "./runPlanner";
import type { SendOutcome, Sender } from "./types";

/**
 * Runs a confirmed plan (specs/057 FR-041 to FR-047, research R12, contracts/execution-safety-rules.md sections 4 to 7).
 *
 * A bounded worker pool, sized by the effective concurrency, takes scenarios in plan order. One shared budget is
 * decremented **before** each request is sent, so concurrency can never overshoot it; when it reaches zero no further
 * request is sent and the rest are recorded `not_run`. Cancelling stops dequeuing and aborts every request in flight.
 * Cleanup then runs once, as its own phase that cancellation does not abort, and every outcome is in the result.
 * A request is never retried automatically, and a block or a failure of one scenario never stops the run.
 *
 * Anything that prevents an honest judgement is recorded as such and never as a pass: a blocked destination is
 * `blocked`, a transport failure is `errored`, cancellation or an exhausted budget is `not_run`. Only a scenario
 * that returned responses is handed to the injected evaluator. The sender and the evaluator are injected, so the
 * whole run is testable with no network and no model.
 */

const logger = createLogger("securityLab.run");

export interface RunServiceDeps {
  readonly sender: Sender;
  readonly evaluator: Evaluator;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly runs: SecurityRunRepository;
  readonly scenarios: SecurityScenarioRepository;
  readonly evidence: SecurityEvidenceRepository;
  readonly findings: SecurityFindingRepository;
}

export interface RunExecutionInput {
  /** The run row already stored as `in-progress`. */
  readonly run: SecurityRun;
  readonly planned: readonly PlannedExecution[];
  readonly profile: SecurityProfile;
  readonly environment: { readonly tier: EnvironmentTier; readonly baseUrl: string };
  readonly apiModel: ApiModel;
  readonly limits: RunLimits;
  readonly credential: CredentialLookup;
  /** Aborted when the run is cancelled. */
  readonly signal: AbortSignal;
  /**
   * Every credential value the profile holds, in every form the sender can put on the wire. Masked by literal match in
   * all evidence, not only the credential a scenario used: a target can echo another identity's key (R14).
   */
  readonly profileSecrets?: readonly string[];
}

/** The shared request counter. Cleanup may draw on an allowance the scenarios may not touch. */
export class Budget {
  private spent = 0;

  constructor(
    private readonly cap: number,
    private readonly cleanupReserve: number,
  ) {}

  get used(): number {
    return this.spent;
  }

  /** Reserves one request for a scenario or one of its redirect hops. */
  reserveScenario(): boolean {
    if (this.spent >= this.cap - this.cleanupReserve) return false;
    this.spent += 1;
    return true;
  }

  /** Reserves one request for cleanup, which may use the whole cap. */
  reserveCleanup(): boolean {
    if (this.spent >= this.cap) return false;
    this.spent += 1;
    return true;
  }
}

const emptySummary = (): Record<ScenarioOutcomeKind, number> => ({ passed: 0, failed: 0, inconclusive: 0, blocked: 0, errored: 0, not_run: 0 });

function isBlocked(outcome: SendOutcome): { reason: string | undefined } | undefined {
  if (outcome.error?.category === "blocked") return { reason: outcome.destination.reason };
  const redirect = outcome.redirects.find((entry) => entry.verdict === "blocked" && entry.reason !== "budget_exhausted");
  return redirect ? { reason: redirect.reason } : undefined;
}

export async function runSecurityRun(deps: RunServiceDeps, input: RunExecutionInput): Promise<void> {
  const { run, planned, profile, environment, limits, signal } = input;
  const ownerId = run.ownerId;
  const sessionId = run.sessionId;
  const cleanupReserve = planned.reduce((sum, entry) => sum + entry.cleanupRequests, 0);
  const budget = new Budget(limits.maxRequests, cleanupReserve);
  const summary = emptySummary();
  const policy: DestinationPolicy = {
    tier: environment.tier,
    allowedHosts: profile.allowedHosts,
    allowedPorts: profile.allowedPorts,
    allowedAddressRanges: profile.allowedAddressRanges,
  };
  const created: CreatedResource[] = [];
  const queue = [...planned];
  const finished = new Set<string>();

  const record = (result: ScenarioResult) => {
    deps.runs.appendResult(ownerId, result);
    summary[result.outcome] += 1;
    finished.add(result.scenarioId);
    deps.runs.updateRun(ownerId, run.id, { budget: { planned: run.budget.planned, used: budget.used }, summary: { ...summary } });
  };

  const notRun = (entry: PlannedExecution, reason: string): ScenarioResult => ({
    id: deps.newId(),
    runId: run.id,
    scenarioId: entry.scenarioId,
    version: entry.version,
    outcome: "not_run",
    reason,
    conditionResults: [],
    observed: basicObservedSummary(undefined, [], "Nothing was sent."),
    evidenceCount: 0,
    startedAt: deps.now().toISOString(),
    durationMs: 0,
  });

  /** What the evaluator said about a result, until the worker has recorded it. Absent when the evaluator did not judge it. */
  const judged = new Map<string, { confidence?: { level: "high" | "medium" | "low"; basis: string } }>();
  const findingContext: FindingContext = { ownerId, repo: deps.findings, now: deps.now, actor: SYSTEM_ACTOR };

  /** A failed result creates or extends the finding of its version; a passed one can verify a resolved finding. Never fails the run. */
  function recordFinding(entry: PlannedExecution, result: ScenarioResult, confidence: { level: "high" | "medium" | "low"; basis: string } | undefined): void {
    try {
      if (result.outcome === "failed" && confidence) {
        const head = deps.scenarios.getScenario(ownerId, entry.scenarioId);
        recordFailure(findingContext, {
          assessmentKey: head?.assessmentKey ?? run.assessmentKey,
          scenarioId: entry.scenarioId,
          version: entry.version,
          content: entry.content,
          resultId: result.id,
          runId: run.id,
          observed: result.observed,
          confidence,
        });
      } else if (result.outcome === "passed") {
        recordPass(findingContext, entry.scenarioId, entry.version);
      }
    } catch {
      logger.error("finding_failed", { runId: run.id, scenarioId: entry.scenarioId, errorCategory: "finding_error" });
    }
  }

  async function executeScenario(entry: PlannedExecution): Promise<ScenarioResult> {
    const startedAt = deps.now();
    const resultId = deps.newId();
    const base = { id: resultId, runId: run.id, scenarioId: entry.scenarioId, version: entry.version, startedAt: startedAt.toISOString() };
    const elapsed = () => deps.now().getTime() - startedAt.getTime();

    const built = buildSecurityRequest({ content: entry.content, apiModel: input.apiModel, profile, baseUrl: environment.baseUrl, credential: input.credential });
    if (!built.ok) {
      return { ...base, outcome: "blocked", reason: built.message, conditionResults: [], observed: basicObservedSummary(undefined, [], "Blocked before sending: the request could not be built."), evidenceCount: 0, durationMs: elapsed() };
    }

    const secrets = [...built.secrets, ...(input.profileSecrets ?? [])];
    const responses: ExecutedResponse[] = [];
    let evidenceCount = 0;
    let blocked: { reason: string | undefined } | undefined;
    let transport: string | undefined;
    let budgetExhausted = false;
    let aborted = false;

    for (let attempt = 0; attempt < built.repeat; attempt += 1) {
      if (signal.aborted) {
        aborted = true;
        break;
      }
      if (!budget.reserveScenario()) {
        budgetExhausted = true;
        break;
      }
      const sentAt = deps.now().toISOString();
      const outcome = await deps.sender.send(built.request, {
        policy,
        tlsPolicy: profile.tlsPolicy,
        timeoutMs: limits.timeoutMs,
        signal,
        reserveHop: () => budget.reserveScenario(),
      });
      // A blocked destination is evidence too: it records the verdict and the reason, and sent nothing.
      deps.evidence.add(sessionId, ownerId, run.id, resultId, evidenceCount, buildEvidenceRecord({ index: evidenceCount, sentAt, request: built.request, outcome, secrets }));
      evidenceCount += 1;

      if (outcome.error?.category === "aborted") {
        aborted = true;
        break;
      }
      const block = isBlocked(outcome);
      if (block) {
        blocked = block;
        break;
      }
      if (outcome.error || outcome.status === undefined) {
        transport = outcome.error?.category ?? "no response";
        break;
      }
      responses.push({ index: attempt, method: built.request.method, status: outcome.status, headers: outcome.headers, bodyText: outcome.bodyText, truncated: outcome.truncated, durationMs: outcome.durationMs });
      if (planCleanup(input.apiModel, entry.content, profile.cleanup).applicable && outcome.status >= 200 && outcome.status < 300) {
        const role = profile.identities.find((identity) => identity.name === built.identity)?.role ?? "";
        created.push({ scenarioId: entry.scenarioId, content: entry.content, role, responseBody: outcome.bodyText });
      }
    }

    const finish = (outcome: ScenarioOutcomeKind, reason: string, statement: string, extra: Partial<ScenarioResult> = {}): ScenarioResult => ({
      ...base,
      outcome,
      reason,
      conditionResults: [],
      observed: basicObservedSummary(responses.at(-1), secrets, statement),
      evidenceCount,
      durationMs: elapsed(),
      ...extra,
    });

    if (aborted) return finish("not_run", "The run was cancelled before this scenario finished.", "Cancelled.");
    if (blocked) {
      const why = describeBlock(blocked.reason);
      return finish("blocked", why, `Blocked: ${blocked.reason ?? "destination"}.`);
    }
    if (transport) return finish("errored", `The request failed (${transport}). Nothing was judged.`, `Request failed: ${transport}.`);
    if (responses.length === 0) return finish("not_run", budgetExhausted ? "The request budget was used up before this scenario could be sent." : "Nothing was sent.", budgetExhausted ? "Budget exhausted." : "Nothing was sent.");

    try {
      const evaluation = deps.evaluator({ content: entry.content, responses, plannedRequests: entry.plannedRequests, secrets });
      judged.set(resultId, { confidence: evaluation.confidence });
      return { ...base, outcome: evaluation.outcome, reason: evaluation.reason, conditionResults: [...evaluation.conditionResults], observed: evaluation.observed, evidenceCount, durationMs: elapsed() };
    } catch {
      // A failing evaluator must not fail the run: the scenario is recorded as executed and not judged.
      logger.error("evaluation_failed", { runId: run.id, scenarioId: entry.scenarioId, errorCategory: "evaluator_error" });
      return finish("inconclusive", "The responses were recorded but could not be evaluated.", `Status ${responses.at(-1)?.status ?? "none"}.`);
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (signal.aborted) return;
      const entry = queue.shift();
      if (!entry) return;
      const result = await executeScenario(entry);
      const judgement = judged.get(result.id);
      judged.delete(result.id);
      if (result.outcome !== "not_run" && result.outcome !== "blocked") {
        // Executed once something was sent; evaluated once the evaluator judged it. An evaluator that failed leaves it executed.
        deps.scenarios.updateHead(ownerId, entry.scenarioId, { executionStatus: judgement ? "evaluated" : "executed", updatedAt: deps.now().toISOString() });
      }
      record(result);
      if (judgement) recordFinding(entry, result, judgement.confidence);
      logger.info("scenario_finished", { runId: run.id, scenarioId: entry.scenarioId, outcome: result.outcome, durationMs: result.durationMs });
    }
  }

  let status: SecurityRun["status"] = "completed";
  try {
    logger.info("run_started", { runId: run.id, scenarios: planned.length, maxConcurrency: limits.maxConcurrency });
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.maxConcurrency, planned.length)) }, () => worker()));
    if (signal.aborted) status = "cancelled";
  } catch {
    status = "failed";
    logger.error("run_failed", { runId: run.id, errorCategory: "unexpected_error" });
  }

  // Everything not reached is recorded, so a settled run has a result per planned scenario.
  const reason = status === "failed" ? "The run stopped because of an internal error." : "The run was cancelled before this scenario started.";
  for (const entry of planned) if (!finished.has(entry.scenarioId)) record(notRun(entry, reason));

  // Cleanup runs once and is not aborted by a cancel. A failure is reported, never swallowed.
  let cleanup = [] as Awaited<ReturnType<typeof runCleanup>>;
  try {
    cleanup = await runCleanup(
      {
        sender: deps.sender,
        apiModel: input.apiModel,
        profile,
        baseUrl: environment.baseUrl,
        policy,
        credential: input.credential,
        timeoutMs: limits.timeoutMs,
        reserve: () => budget.reserveCleanup(),
        reserveHop: () => budget.reserveCleanup(),
      },
      profile.cleanup,
      created,
    );
  } catch {
    logger.error("cleanup_failed", { runId: run.id, errorCategory: "unexpected_error" });
    cleanup = created.map((resource) => ({
      scenarioId: resource.scenarioId,
      action: `Clean up ${resource.content.operationKey}`,
      state: "failed" as const,
      detail: "Cleanup stopped because of an internal error.",
      leftBehind: `A resource created by ${resource.content.operationKey}`,
      manualRemoval: "Remove it in the target system by hand.",
    }));
  }

  deps.runs.updateRun(ownerId, run.id, {
    status,
    completedAt: deps.now().toISOString(),
    budget: { planned: run.budget.planned, used: budget.used },
    summary: { ...summary },
    cleanup,
  });
  logger.info("run_finished", { runId: run.id, status, used: budget.used, failedCleanups: cleanup.filter((entry) => entry.state === "failed").length });
}
