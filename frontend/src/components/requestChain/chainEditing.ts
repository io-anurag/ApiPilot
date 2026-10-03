import type { Chain, ChainPlan, ChainPlanInput, ChainStep, Extractor, StepCheck } from "@apipilot/shared-domain";

/**
 * Pure edits of a request-chain plan for the editor (specs/037-request-chain-performance FR-002,
 * FR-003). New chains, steps, extractors and checks take their ids from the plan's counters, as the
 * server requires (research R2); a duplicated step is a new step, "Added by you". Reordering and
 * moving are never refused here: the analysis lists what an order breaks (FR-014).
 */

export function inputOf(plan: ChainPlan): ChainPlanInput {
  return {
    name: plan.name,
    chains: plan.chains.map((chain) => ({ id: chain.id, name: chain.name, steps: chain.steps.map(({ source: _source, seedDigest: _digest, changed: _changed, ...rest }) => rest) })),
    loadProfile: plan.loadProfile,
    thinkTimeMs: plan.thinkTimeMs,
    thresholds: plan.thresholds,
    targetEnvironmentId: plan.targetEnvironmentId,
    secretNames: plan.secretNames,
    seedingReport: plan.seedingReport,
    nextChainNumber: plan.nextChainNumber,
    nextStepNumber: plan.nextStepNumber,
    nextItemNumber: plan.nextItemNumber,
  };
}

export function newStep(id: string): ChainStep {
  return {
    id,
    name: "New request",
    method: "GET",
    url: "{{baseUrl}}/",
    query: [],
    headers: [],
    body: { kind: "none" },
    expectedStatuses: ["200"],
    extractors: [],
    checks: [],
    runs: "every-iteration",
    thinkTimeMs: null,
    source: { kind: "added" },
    seedDigest: null,
    changed: false,
  };
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function mapChain(plan: ChainPlan, chainId: string, edit: (chain: Chain) => Chain): ChainPlan {
  return { ...plan, chains: plan.chains.map((chain) => (chain.id === chainId ? edit(chain) : chain)) };
}

export function addChain(plan: ChainPlan, name: string): ChainPlan {
  return { ...plan, chains: [...plan.chains, { id: `c${plan.nextChainNumber}`, name, steps: [] }], nextChainNumber: plan.nextChainNumber + 1 };
}

export function renameChain(plan: ChainPlan, chainId: string, name: string): ChainPlan {
  return mapChain(plan, chainId, (chain) => ({ ...chain, name }));
}

export function moveChain(plan: ChainPlan, chainId: string, offset: -1 | 1): ChainPlan {
  const index = plan.chains.findIndex((chain) => chain.id === chainId);
  return { ...plan, chains: move(plan.chains, index, index + offset) };
}

export function deleteChain(plan: ChainPlan, chainId: string): ChainPlan {
  return { ...plan, chains: plan.chains.filter((chain) => chain.id !== chainId) };
}

/** A copy of `step` with new ids for itself and its extractors and checks. */
function copyStep(plan: ChainPlan, step: ChainStep): { step: ChainStep; plan: ChainPlan } {
  let item = plan.nextItemNumber;
  const extractors: Extractor[] = step.extractors.map((extractor) => ({ ...extractor, id: `x${item++}` }));
  const checks: StepCheck[] = step.checks.map((check) => ({ ...check, id: `k${item++}` }));
  const copy: ChainStep = { ...step, id: `s${plan.nextStepNumber}`, name: `${step.name} (copy)`, extractors, checks, source: { kind: "added" }, seedDigest: null, changed: false };
  return { step: copy, plan: { ...plan, nextStepNumber: plan.nextStepNumber + 1, nextItemNumber: item } };
}

export function duplicateChain(plan: ChainPlan, chainId: string): ChainPlan {
  const source = plan.chains.find((chain) => chain.id === chainId);
  if (!source) return plan;
  let next: ChainPlan = { ...plan, nextChainNumber: plan.nextChainNumber + 1 };
  const steps: ChainStep[] = [];
  for (const step of source.steps) {
    const copied = copyStep(next, step);
    next = copied.plan;
    steps.push(copied.step);
  }
  const index = plan.chains.indexOf(source);
  const chains = [...plan.chains];
  chains.splice(index + 1, 0, { id: `c${plan.nextChainNumber}`, name: `${source.name} (copy)`, steps });
  return { ...next, chains };
}

export function addStep(plan: ChainPlan, chainId: string): { plan: ChainPlan; stepId: string } {
  const step = newStep(`s${plan.nextStepNumber}`);
  return { plan: mapChain({ ...plan, nextStepNumber: plan.nextStepNumber + 1 }, chainId, (chain) => ({ ...chain, steps: [...chain.steps, step] })), stepId: step.id };
}

export function updateStep(plan: ChainPlan, stepId: string, edit: (step: ChainStep) => ChainStep): ChainPlan {
  return { ...plan, chains: plan.chains.map((chain) => ({ ...chain, steps: chain.steps.map((step) => (step.id === stepId ? edit(step) : step)) })) };
}

export function moveStep(plan: ChainPlan, stepId: string, offset: -1 | 1): ChainPlan {
  return {
    ...plan,
    chains: plan.chains.map((chain) => {
      const index = chain.steps.findIndex((step) => step.id === stepId);
      return index < 0 ? chain : { ...chain, steps: move(chain.steps, index, index + offset) };
    }),
  };
}

export function moveStepToChain(plan: ChainPlan, stepId: string, chainId: string): ChainPlan {
  const step = plan.chains.flatMap((chain) => chain.steps).find((candidate) => candidate.id === stepId);
  if (!step) return plan;
  const without = { ...plan, chains: plan.chains.map((chain) => ({ ...chain, steps: chain.steps.filter((candidate) => candidate.id !== stepId) })) };
  return mapChain(without, chainId, (chain) => ({ ...chain, steps: [...chain.steps, step] }));
}

export function duplicateStep(plan: ChainPlan, stepId: string): { plan: ChainPlan; stepId: string } {
  const chain = plan.chains.find((candidate) => candidate.steps.some((step) => step.id === stepId));
  if (!chain) return { plan, stepId };
  const index = chain.steps.findIndex((step) => step.id === stepId);
  const copied = copyStep(plan, chain.steps[index]);
  const steps = [...chain.steps];
  steps.splice(index + 1, 0, copied.step);
  return { plan: mapChain(copied.plan, chain.id, (current) => ({ ...current, steps })), stepId: copied.step.id };
}

export function deleteStep(plan: ChainPlan, stepId: string): ChainPlan {
  return { ...plan, chains: plan.chains.map((chain) => ({ ...chain, steps: chain.steps.filter((step) => step.id !== stepId) })) };
}

/** A new extractor or check id, and the plan with its counter moved on. */
export function nextItemId(plan: ChainPlan, prefix: "x" | "k"): { plan: ChainPlan; id: string } {
  return { plan: { ...plan, nextItemNumber: plan.nextItemNumber + 1 }, id: `${prefix}${plan.nextItemNumber}` };
}

/** Splits a pasted URL into its URL and its query rows (research R4); `null` when there is no query. */
export function splitPastedUrl(text: string): { url: string; query: { name: string; value: string }[] } | null {
  const hashless = text.split("#")[0];
  const at = hashless.indexOf("?");
  if (at < 0) return text.includes("#") ? { url: hashless, query: [] } : null;
  const query = hashless
    .slice(at + 1)
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const decode = (part: string) => {
        try {
          return decodeURIComponent(part.replace(/\+/g, " "));
        } catch {
          return part;
        }
      };
      return equals < 0 ? { name: decode(pair), value: "" } : { name: decode(pair.slice(0, equals)), value: decode(pair.slice(equals + 1)) };
    });
  return { url: hashless.slice(0, at), query };
}
