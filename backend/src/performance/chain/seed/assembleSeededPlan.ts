import { randomUUID } from "node:crypto";
import type { Chain, ChainPlan, ChainStep, Extractor, SeedingReport, SeedingReportItem, StepSource } from "@apipilot/shared-domain";
import { startingProfile } from "../../plan/loadProfiles";
import { moveLiteralCredentials, type CredentialMove } from "../literalCredentials";
import { stepContentDigest, withFingerprint } from "../savePlan";
import type { SeedRequest } from "./toChainStep";

/**
 * Turns what a seeder read into a stored-ready plan (specs/037-request-chain-performance FR-020,
 * FR-025, FR-027; research R15 to R18). Ids come from counters in the order seeded, so the same
 * source and selection always give the same chains, steps, extractors and digests. Literal
 * credentials are moved to the named environment, or dropped and listed when none is named; either
 * way no literal stays in the plan. Each step's seed digest is taken last, so a step counts as
 * changed only after the engineer edits it.
 */
export interface SeedStep {
  name: string;
  request: SeedRequest;
  expectedStatuses: string[];
  extractors: Omit<Extractor, "id">[];
  runs: ChainStep["runs"];
  source: Exclude<StepSource, { kind: "added" }>;
}

export interface SeedInput {
  name: string;
  chains: { name: string; steps: SeedStep[] }[];
  secretNames: string[];
  report: Omit<SeedingReport, "items"> & { items: Omit<SeedingReportItem, "stepId">[] };
  /** Report items that concern a step, keyed by the step's position: chain index and step index. */
  stepItems?: { chain: number; step: number; item: Omit<SeedingReportItem, "stepId"> }[];
  environment: { name: string; valueNames: readonly string[] } | null;
  now: string;
}

export interface SeededPlan {
  plan: ChainPlan;
  /** Values to write to the environment; empty when it was not named (they were dropped). */
  moves: CredentialMove[];
}

function labelOf(source: SeedStep["source"]): string {
  return source.label;
}

export function assembleSeededPlan(input: SeedInput): SeededPlan {
  let stepNumber = 1;
  let itemNumber = 1;
  const positions = new Map<string, string>();
  const chains: Chain[] = input.chains.map((chain, chainIndex) => ({
    id: `c${chainIndex + 1}`,
    name: chain.name.slice(0, 120) || `Chain ${chainIndex + 1}`,
    steps: chain.steps.map((seed, stepIndex) => {
      const id = `s${stepNumber++}`;
      positions.set(`${chainIndex}:${stepIndex}`, id);
      return {
        id,
        name: seed.name.slice(0, 120) || id,
        ...seed.request,
        expectedStatuses: seed.expectedStatuses,
        extractors: seed.extractors.map((extractor) => ({ ...extractor, id: `x${itemNumber++}` })),
        checks: [],
        runs: seed.runs,
        thinkTimeMs: null,
        source: seed.source,
        seedDigest: null,
        changed: false,
      };
    }),
  }));

  const draft: ChainPlan = {
    id: randomUUID(),
    name: input.name,
    revision: 1,
    chains: chains.length > 0 ? chains : [{ id: "c1", name: "Chain 1", steps: [] }],
    loadProfile: startingProfile("smoke"),
    thinkTimeMs: 1000,
    thresholds: [],
    targetEnvironmentId: null,
    secretNames: [...new Set(input.secretNames)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    dataSets: [],
    seedingReport: null,
    nextChainNumber: Math.max(2, chains.length + 1),
    nextStepNumber: stepNumber,
    nextItemNumber: itemNumber,
    fingerprint: "",
    createdAt: input.now,
    updatedAt: input.now,
  };

  const moved = moveLiteralCredentials(draft, input.environment ?? { name: "", valueNames: [] });
  const stepsById = new Map(moved.plan.chains.flatMap((chain) => chain.steps.map((step) => [step.id, step] as const)));
  const credentialItems: SeedingReportItem[] = moved.moves.map((move) => {
    const step = stepsById.get(move.stepId)!;
    const where = move.location.kind === "header" ? `${move.location.name} header` : `${move.location.path} field`;
    return input.environment
      ? { kind: "literal-credential-moved", sourceLabel: labelOf(step.source as SeedStep["source"]), detail: `The ${where} value was moved into the secret value ${move.valueName} of ${input.environment.name}.`, stepId: step.id }
      : {
          kind: "literal-credential-dropped",
          sourceLabel: labelOf(step.source as SeedStep["source"]),
          detail: `The ${where} value was not kept, because no environment was named. Set ${move.valueName} as a secret value of the target environment.`,
          stepId: step.id,
        };
  });

  const items: SeedingReportItem[] = [
    ...input.report.items.map((item) => ({ ...item, stepId: null })),
    ...(input.stepItems ?? []).map((entry) => ({ ...entry.item, stepId: positions.get(`${entry.chain}:${entry.step}`) ?? null })),
    ...credentialItems,
  ];
  const seeded: ChainPlan = {
    ...moved.plan,
    chains: moved.plan.chains.map((chain) => ({ ...chain, steps: chain.steps.map((step) => ({ ...step, seedDigest: stepContentDigest(step), changed: false })) })),
    seedingReport: { source: input.report.source, seededAt: input.report.seededAt, items },
  };
  return { plan: withFingerprint(seeded), moves: input.environment ? moved.moves : [] };
}
