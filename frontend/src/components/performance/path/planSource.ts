import { seededOperationKeys, type ChainPlan } from "@apipilot/shared-domain";
import type { SourceKind } from "./pathState";

export interface PlanSource {
  source: SourceKind;
  /** How the source reads after "Seeded from": a file name, "the guided workflow", "the collection NAME". */
  label: string;
  /** The operation keys the plan was seeded with (specification plans only). */
  selection: string[];
}

/** What a stored plan was seeded from, read from its seeding report and steps; a plan with no report was built by the engineer. */
export function sourceOfPlan(plan: ChainPlan): PlanSource {
  const seed = plan.seedingReport?.source;
  if (!seed) return { source: "empty", label: "an empty plan", selection: [] };
  if (seed.kind === "specification") return { source: "specification", label: seed.filename, selection: seededOperationKeys(plan) };
  if (seed.kind === "collection") return { source: "collection", label: `the collection ${seed.collectionName}`, selection: [] };
  return { source: "workflow", label: "the guided workflow", selection: [] };
}

/** The header's "Seeded from …" text, or "Built by you" for a plan with no source. */
export function seededFromText(plan: ChainPlan): string {
  const { source, label } = sourceOfPlan(plan);
  return source === "empty" ? "Built by you" : `Seeded from ${label}`;
}
