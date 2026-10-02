import { Router } from "express";
import type { PerformancePlan, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { buildPlan, contextFromWorkflow, rebuildPlan, upstreamFingerprint } from "../performance/plan/buildPlan";
import { openApiEngine } from "../performance/plan/openApiEngine";
import { getGeneratedScript, setGeneratedScript } from "../performance/scriptStore";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "../testGenerationWorkflow/workflowStore";
import { PlanSourceUnavailableError } from "./performanceHttp";
import {
  registerPerformanceRoutes,
  type PerformancePlanSource,
  type PerformanceTestingDependencies,
  type PlanHandle,
} from "./performanceRoutes";

export type { PerformanceTestingDependencies } from "./performanceRoutes";

/**
 * AP-029 k6 performance testing routes (specs/031-k6-performance-testing
 * contracts/performance-api.md): the guided workflow's plan source. Every route is scoped to the
 * calling session's guided workflow; the route bodies are shared with AP-032's quick performance
 * test through `registerPerformanceRoutes` (specs/032-quick-performance-test research Q2).
 */
const BASE = "/test-generation-workflow/performance";

/** The stage gate (research D1): Postman generation must be complete. */
export function requirePostmanGenerationComplete(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.postmanGeneration.status !== "complete") {
    throw new PlanSourceUnavailableError(409, "postman_generation_incomplete", "Performance testing opens once the Postman collection has been generated.");
  }
  return workflow;
}

/**
 * The session's current plan: built on first read, and rebuilt (keeping the user's choices) when
 * the approvals it was built from have changed since (research D1, D26).
 */
export function currentPlan(workflow: TestGenerationWorkflow): PerformancePlan {
  const context = contextFromWorkflow(workflow);
  const existing = workflow.performancePlan;
  if (existing && existing.upstreamFingerprint === upstreamFingerprint(context)) return existing;
  const plan = existing ? rebuildPlan(existing, context, { keepOrder: true }) : buildPlan(context);
  patchWorkflow({ performancePlan: plan });
  return plan;
}

function stageStatus() {
  return getCurrentWorkflow()!.stages.performanceTesting.status;
}

function guidedHandle(): PlanHandle {
  const workflow = requirePostmanGenerationComplete();
  return {
    engine: openApiEngine(contextFromWorkflow(workflow)),
    plan: () => currentPlan(getCurrentWorkflow()!),
    savePlan: (plan) => patchWorkflow({ performancePlan: plan }),
    script: () => getGeneratedScript(),
    saveScript: (script) => setGeneratedScript(script),
    onOpen: () => {
      const status = workflow.stages.performanceTesting.status;
      if (status === "not-yet-reached" || status === "stale") advanceActiveStage("performanceTesting");
    },
    onPlanChanged: (before, after) => {
      if (after.fingerprint !== before.fingerprint && stageStatus() === "complete") updateStage("performanceTesting", "active");
    },
    onPlanReset: (plan) => {
      const script = getGeneratedScript();
      if (stageStatus() === "complete" && script && script.planFingerprint !== plan.fingerprint) updateStage("performanceTesting", "active");
    },
    onScriptGenerated: () => {
      if (stageStatus() === "active") updateStage("performanceTesting", "complete");
    },
  };
}

const guidedSource: PerformancePlanSource = { kind: "guided", require: guidedHandle };

export function createPerformanceTestingRouter(dependencies: PerformanceTestingDependencies): Router {
  const router = Router();
  registerPerformanceRoutes(router, BASE, guidedSource, dependencies);
  return router;
}
