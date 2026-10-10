import type { ChainRunSnapshot } from "@apipilot/shared-domain";
import { pathOfTemplate } from "./recentRing";

/**
 * What the live view shows about a chain step (AP-045 research R5): its name, method and the path
 * template of the plan, never a resolved URL, so a variable's value cannot appear. k6 does not tag
 * its requests with the path (constitution XVIII), so the path can only come from the plan.
 */
export interface LiveStepInfo {
  chainId: string;
  chainName: string;
  stepName: string;
  method: string;
  path: string;
}

export function liveStepInfoFromChain(snapshot: ChainRunSnapshot): Map<string, LiveStepInfo> {
  const info = new Map<string, LiveStepInfo>();
  for (const chain of snapshot.chains) {
    for (const step of chain.steps) {
      info.set(step.id, { chainId: chain.id, chainName: chain.name, stepName: step.name, method: step.method, path: pathOfTemplate(step.pathTemplate) });
    }
  }
  return info;
}
