import type { ChainPlan, ChainPlanAnalysis } from "@apipilot/shared-domain";
import { PlanHasBlockersError } from "../errors";
import { chainStepCount, renderChainScript } from "../k6/renderChainScript";
import { sha256Hex } from "../plan/identifiers";
import { saveChainScript, type GeneratedScript } from "../scriptStore";

/**
 * Generates a request-chain plan's script (specs/037-request-chain-performance contracts "Script").
 * Refused while the analysis lists a blocker (FR-014); the script is kept in memory by plan id with
 * the plan's fingerprint, so any later change marks it out of date (FR-032). Generating never starts
 * a run.
 */
export function generateChainScript(plan: ChainPlan, analysis: ChainPlanAnalysis): GeneratedScript {
  if (analysis.blockers.length > 0) throw new PlanHasBlockersError(analysis.blockers);
  const rendered = renderChainScript(plan, analysis);
  const script: GeneratedScript = {
    planFingerprint: plan.fingerprint,
    scriptSha256: sha256Hex(rendered.script),
    environmentTemplateSha256: sha256Hex(rendered.environmentTemplate),
    script: rendered.script,
    environmentTemplate: rendered.environmentTemplate,
    stepCount: chainStepCount(plan),
    valueIndex: rendered.valueIndex,
  };
  saveChainScript(plan.id, script);
  return script;
}
