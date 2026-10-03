import { analyzeChainPlan, type ChainPlan } from "@apipilot/shared-domain";
import { planFingerprint } from "../../../src/performance/chain/savePlan";
import { renderChainScript } from "../../../src/performance/k6/renderChainScript";
import { loadScript, type IterationCounter, type K6Sandbox, type SandboxRequest, type SandboxResponse } from "../performance/k6Sandbox";

/** AP-037 (tasks T025): renders a request-chain plan and loads it in the k6 sandbox. */
export interface ChainSandboxOptions {
  values?: Record<string, string>;
  respond: (request: SandboxRequest) => SandboxResponse;
  vu?: number;
  files?: Record<string, string>;
  iterations?: IterationCounter;
  runTag?: string;
}

export function renderPlan(plan: ChainPlan) {
  const fingerprinted = { ...plan, fingerprint: planFingerprint(plan) };
  return renderChainScript(fingerprinted, analyzeChainPlan(fingerprinted, { environmentValueNames: null }));
}

export function loadChainPlan(plan: ChainPlan, options: ChainSandboxOptions): K6Sandbox {
  const rendered = renderPlan(plan);
  const env: Record<string, string> = options.runTag ? { APIPILOT_RUN_TAG: options.runTag } : {};
  for (const [name, value] of Object.entries(options.values ?? {})) {
    const index = rendered.valueIndex[name];
    if (index !== undefined) env[`APIPILOT_V_${index}`] = value;
  }
  return loadScript(rendered.script, { env, respond: options.respond, vu: options.vu, files: options.files, iterations: options.iterations });
}

/** The counter points named `name`, as `[tags]`. */
export function counted(sandbox: K6Sandbox, name: string): Record<string, string>[] {
  return sandbox.metrics.filter((metric) => metric.name === name).map((metric) => metric.tags);
}
