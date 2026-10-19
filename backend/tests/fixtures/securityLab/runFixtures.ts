import type { ApiModel, SecurityProfile, SecurityScenarioContent } from "@apipilot/shared-domain";
import type { SecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { basisHashes } from "../../../src/securityLab/analysis/securityBasisHash";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { generateSecurityScenarios } from "../../../src/securityLab/scenarios/generateSecurityScenarios";
import { contentHashOf } from "../../../src/securityLab/scenarios/scenarioIdentity";
import { ALICE_EXPIRED_TOKEN, ALICE_KEY, ALICE_TOKEN, BOB_KEY, BOB_TOKEN } from "./fixtureCredentials";
import { OWNER_A, T0, T1, makeProfile, makeScenario, makeVersion } from "./builders";
import { loadSecurityFixtureModel } from "./loadModel";

export { ALICE_EXPIRED_TOKEN, ALICE_KEY, ALICE_TOKEN, BOB_KEY, BOB_TOKEN };

export const FIXTURE_CREDENTIALS: Readonly<Record<string, string>> = {
  "alice/bearerAuth/active": ALICE_TOKEN,
  "bob/bearerAuth/active": BOB_TOKEN,
  "alice/apiKeyAuth/active": ALICE_KEY,
  "bob/apiKeyAuth/active": BOB_KEY,
  "alice/bearerAuth/expired": ALICE_EXPIRED_TOKEN,
};

/** A credential lookup over the fixture values, by identity, scheme and kind. */
export const fixtureCredential = (identity: string, scheme: string, kind: "active" | "expired"): string | undefined => FIXTURE_CREDENTIALS[`${identity}/${scheme}/${kind}`];

export const hasFixtureCredential = (identity: string, scheme: string, kind: "active" | "expired"): boolean => fixtureCredential(identity, scheme, kind) !== undefined;

export const sampleModel = (): Promise<ApiModel> => loadSecurityFixtureModel("sample-api.yaml");

/** A profile with two identities holding every credential the sample specification uses, and test data for an owned order. */
export function fullProfile(overrides: Partial<SecurityProfile> = {}): SecurityProfile {
  return makeProfile({
    identities: [
      { name: "alice", role: "owner", credentialSchemes: ["bearerAuth", "apiKeyAuth"], expiredCredentialSchemes: ["bearerAuth"] },
      { name: "bob", role: "other-user", credentialSchemes: ["bearerAuth", "apiKeyAuth"] },
    ],
    testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "ord-1001" }],
    permittedCategories: [
      "authentication",
      "authorization",
      "broken-object-level-authorization",
      "object-property-authorization",
      "input-validation",
      "resource-consumption",
      "sensitive-data-exposure",
      "security-misconfiguration",
    ],
    ...overrides,
  });
}

export interface GeneratedFixture {
  readonly id: string;
  readonly content: SecurityScenarioContent;
}

/** The scenarios the generator really produces for `model`, so a test judges real content and not a hand-made imitation. */
export function generatedScenarios(model: ApiModel, profile?: SecurityProfile): GeneratedFixture[] {
  return generateSecurityScenarios({ apiModel: model, scope: "all", limits: loadSecurityLabLimits({}), profile, configuredSensitiveFields: [] }).scenarios.map((scenario) => ({
    id: scenario.id,
    content: scenario.content,
  }));
}

/** The first generated scenario for `operationKey` whose first mutation is `kind`. Throws when there is none, so a test never silently skips. */
export function pick(scenarios: readonly GeneratedFixture[], operationKey: string, kind: string): GeneratedFixture {
  const found = scenarios.find((scenario) => scenario.content.operationKey === operationKey && scenario.content.mutations.some((mutation) => mutation.kind === kind));
  if (!found) throw new Error(`No generated scenario for ${operationKey} with a ${kind} mutation`);
  return found;
}

export interface SeedOptions {
  readonly ownerId?: string;
  readonly approved?: boolean;
  readonly destructiveConfirmed?: boolean;
  readonly basisHash?: string;
}

/** Inserts a generated scenario as approved at version 1, bound to the real basis hash of its operation. */
export function seedGenerated(repo: SecurityScenarioRepository, model: ApiModel, scenario: GeneratedFixture, options: SeedOptions = {}): void {
  const ownerId = options.ownerId ?? OWNER_A;
  const approved = options.approved ?? true;
  const { content } = scenario;
  const contentHash = contentHashOf(content);
  repo.insertScenario(
    makeScenario({ id: scenario.id, ownerId, reviewState: approved ? "approved" : "draft" }),
    { operationKey: content.operationKey, categoryId: content.categoryId, severity: content.suggestedSeverity, destructive: content.destructive.flag, title: content.title },
    T0,
  );
  repo.insertVersion(
    ownerId,
    makeVersion({
      scenarioId: scenario.id,
      content,
      contentHash,
      securityBasisHash: options.basisHash ?? basisHashes(model).get(content.operationKey) ?? "",
      ...(approved ? { approval: { version: 1, contentHash, approvedAt: T1, actor: "tester", destructiveConfirmed: options.destructiveConfirmed ?? content.destructive.flag } } : {}),
    }),
  );
}
