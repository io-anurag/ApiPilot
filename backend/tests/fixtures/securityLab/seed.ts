import type { ScenarioDerivedFlags, SecurityReviewState, SecurityScenarioContent } from "@apipilot/shared-domain";
import type { SecurityScenarioRepository, StoredScenario } from "../../../src/persistence/securityScenarioRepository";
import type { ReviewContext } from "../../../src/securityLab/review/reviewService";
import { contentHashOf } from "../../../src/securityLab/scenarios/scenarioIdentity";
import { OWNER_A, T0, makeContent, makeScenario, makeVersion } from "./builders";

/** Inserts a scenario and its first version, with the content hash computed the way the service computes it. */
export function seedScenario(
  repo: SecurityScenarioRepository,
  options: {
    id?: string;
    ownerId?: string;
    reviewState?: SecurityReviewState;
    content?: Partial<SecurityScenarioContent>;
    basisHash?: string;
  } = {},
): { id: string; content: SecurityScenarioContent } {
  const id = options.id ?? "ss-0000000000000001";
  const ownerId = options.ownerId ?? OWNER_A;
  const content = makeContent(options.content ?? {});
  repo.insertScenario(
    makeScenario({ id, ownerId, reviewState: options.reviewState ?? "draft" }),
    { operationKey: content.operationKey, categoryId: content.categoryId, severity: content.suggestedSeverity, destructive: content.destructive.flag, title: content.title },
    T0,
  );
  repo.insertVersion(ownerId, makeVersion({ scenarioId: id, content, contentHash: contentHashOf(content), securityBasisHash: options.basisHash ?? "basis-1" }));
  return { id, content };
}

export const CURRENT_FLAGS: ScenarioDerivedFlags = { specificationNotLoaded: false, stale: false, orphaned: false, blocked: false, executable: false };

/** A review context with a fixed clock and caller-controlled flags. */
export function reviewContext(
  repo: SecurityScenarioRepository,
  flags: Partial<ScenarioDerivedFlags> | ((scenario: StoredScenario) => Partial<ScenarioDerivedFlags>) = {},
  now = T0,
): ReviewContext {
  return {
    repo,
    now: () => new Date(now),
    actor: "tester",
    flagsFor: (scenario) => ({ ...CURRENT_FLAGS, ...(typeof flags === "function" ? flags(scenario) : flags) }),
  };
}
