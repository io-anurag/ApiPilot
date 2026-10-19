import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel, RunPlanProblemCode, SecurityProfile } from "@apipilot/shared-domain";
import { getSecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { computePlanDigest } from "../../../src/securityLab/execution/planDigest";
import { REAL_REQUESTS_STATEMENT, planRun, type PlannerContext } from "../../../src/securityLab/execution/runPlanner";
import { OWNER_A, T0 } from "../../fixtures/securityLab/builders";
import {
  ALICE_TOKEN,
  fixtureCredential,
  fullProfile,
  generatedScenarios,
  hasFixtureCredential,
  pick,
  sampleModel,
  seedGenerated,
  type GeneratedFixture,
} from "../../fixtures/securityLab/runFixtures";

const repo = () => getSecurityScenarioRepository();
const ENVIRONMENT = { name: "Local sample", tier: "local", baseUrl: "http://127.0.0.1:4700" };

let model: ApiModel;
let scenarios: GeneratedFixture[];

beforeEach(async () => {
  model = await sampleModel();
  scenarios = generatedScenarios(model);
});

function context(overrides: Partial<PlannerContext> = {}): PlannerContext {
  return {
    ownerId: OWNER_A,
    repo: repo(),
    apiModel: model,
    profile: fullProfile(),
    environment: ENVIRONMENT,
    limits: loadSecurityLabLimits({}),
    hasCredential: hasFixtureCredential,
    credential: fixtureCredential,
    ...overrides,
  };
}

const item = (scenario: GeneratedFixture, version = 1) => ({ id: scenario.id, version });
const codes = (plan: ReturnType<typeof planRun>): RunPlanProblemCode[] => plan.preview.problems.map((problem) => problem.code);

describe("a valid plan", () => {
  it("has no problems, counts the planned requests, and names the target in the summary", () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    const invalid = pick(scenarios, "GET /orders", "auth.invalid-token");
    seedGenerated(repo(), model, omit);
    seedGenerated(repo(), model, invalid);
    const plan = planRun(context(), { items: [item(omit), item(invalid)] });
    expect(plan.preview.problems).toEqual([]);
    expect(plan.planned.map((entry) => entry.scenarioId)).toEqual([omit.id, invalid.id]);
    expect(plan.preview.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.preview.summary).toMatchObject({
      profileName: "Local sample",
      environmentName: "Local sample",
      tier: "local",
      baseUrl: "http://127.0.0.1:4700",
      tlsPolicy: "verify",
      scenarioCount: 2,
      plannedRequests: 2,
      cleanupRequests: 0,
      destructive: [],
      destinations: [{ host: "127.0.0.1", port: 4700 }],
      statement: REAL_REQUESTS_STATEMENT,
    });
    expect(plan.limits).toEqual({ maxRequests: 100, maxConcurrency: 1, timeoutMs: 10_000 });
    expect(plan.preview.scenarios.map((entry) => entry.title)).toEqual([omit.content.title, invalid.content.title]);
  });

  it("keeps the order the person chose", () => {
    const a = pick(scenarios, "GET /orders", "auth.omit");
    const b = pick(scenarios, "GET /orders", "auth.malformed");
    seedGenerated(repo(), model, a);
    seedGenerated(repo(), model, b);
    expect(planRun(context(), { items: [item(b), item(a)] }).planned.map((entry) => entry.scenarioId)).toEqual([b.id, a.id]);
  });

  it("never reads a credential value into the preview", () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    seedGenerated(repo(), model, omit);
    const plan = planRun(context(), { items: [item(omit)] });
    expect(JSON.stringify(plan.preview)).not.toContain(ALICE_TOKEN);
  });
});

describe("what makes a scenario unrunnable, each with its own code", () => {
  const plan = (scenario: GeneratedFixture, overrides: Partial<PlannerContext> = {}, version = 1) => planRun(context(overrides), { items: [item(scenario, version)] });

  it("refuses an empty selection and a repeated scenario", () => {
    expect(codes(planRun(context(), { items: [] }))).toEqual(["no_items"]);
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    seedGenerated(repo(), model, omit);
    const repeated = planRun(context(), { items: [item(omit), item(omit)] });
    expect(codes(repeated)).toEqual(["duplicate_item"]);
    expect(repeated.planned).toHaveLength(1);
  });

  it("refuses a scenario that does not exist, and a version that is not the current one", () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    expect(codes(plan(omit))).toEqual(["scenario_not_found"]);
    seedGenerated(repo(), model, omit);
    const stale = plan(omit, {}, 7);
    expect(codes(stale)).toEqual(["stale_version"]);
    expect(stale.planned).toEqual([]);
  });

  it("refuses a scenario that is not approved", () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    seedGenerated(repo(), model, omit, { approved: false });
    expect(codes(plan(omit))).toEqual(["not_approved"]);
  });

  it("refuses an approval whose content no longer matches, so an edited scenario never runs on an older approval", () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    seedGenerated(repo(), model, omit);
    const tampered = { ...omit, content: { ...omit.content, mutations: [{ kind: "auth.malformed" as const }] } };
    repo().insertVersion(OWNER_A, {
      scenarioId: omit.id,
      version: 2,
      contentHash: "f".repeat(64),
      specificationRevision: "rev",
      securityBasisHash: "basis",
      content: tampered.content,
      author: "user",
      createdAt: T0,
      materialChange: true,
    });
    repo().updateHead(OWNER_A, omit.id, { currentVersion: 2, reviewState: "approved", updatedAt: T0 });
    expect(codes(plan(omit, {}, 2))).toContain("not_approved");
  });

  it("refuses a scenario whose operation changed, whose operation is gone, and any scenario when no specification is loaded", () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    seedGenerated(repo(), model, omit, { basisHash: "an-older-basis" });
    expect(codes(plan(omit))).toEqual(["operation_changed"]);

    const status = pick(scenarios, "GET /orders", "auth.invalid-token");
    seedGenerated(repo(), model, status);
    const without = { ...model, operations: model.operations.filter((operation) => !(operation.method.toUpperCase() === "GET" && operation.path === "/orders")) };
    expect(codes(plan(status, { apiModel: without }))).toEqual(["operation_missing"]);
    expect(codes(plan(status, { apiModel: undefined }))).toEqual(["specification_not_loaded"]);
  });

  it("refuses a category the profile does not permit", () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    seedGenerated(repo(), model, omit);
    expect(codes(plan(omit, { profile: fullProfile({ permittedCategories: ["input-validation"] }) }))).toEqual(["category_not_permitted"]);
  });

  it("refuses a scenario whose prerequisites are unmet, saying exactly what is missing", () => {
    const omit = pick(scenarios, "GET /orders", "auth.expired");
    seedGenerated(repo(), model, omit);
    const result = plan(omit, { profile: fullProfile({ identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] }] }), hasCredential: () => false });
    expect(codes(result)).toEqual(["prerequisite_unmet"]);
    expect(result.preview.problems[0].message).toMatch(/known-expired credential/);
  });

  it("refuses a scenario whose request cannot be built, for example when a credential is not set", () => {
    const invalid = pick(scenarios, "GET /orders", "auth.expired");
    seedGenerated(repo(), model, invalid);
    // The prerequisite check passes (the credential is "set") but the value cannot be read: the build is what notices.
    const result = plan(invalid, { credential: () => undefined });
    expect(codes(result)).toEqual(["request_not_buildable"]);
  });
});

describe("destructive scenarios", () => {
  const destructive = () => pick(scenarios, "DELETE /orders/{orderId}", "path-id.substitute");

  it("needs the profile to permit them and the approval to carry the destructive confirmation", () => {
    const scenario = destructive();
    expect(scenario.content.destructive.flag).toBe(true);
    seedGenerated(repo(), model, scenario, { destructiveConfirmed: false });
    const notPermitted = planRun(context(), { items: [item(scenario)] });
    expect(codes(notPermitted).sort()).toEqual(["destructive_not_approved", "destructive_not_permitted"]);

    const permitted = planRun(context({ profile: fullProfile({ destructivePermitted: true }) }), { items: [item(scenario)] });
    expect(codes(permitted)).toEqual(["destructive_not_approved"]);
  });

  it("is runnable when permitted and approved with confirmation, and is listed by operation for the person to confirm", () => {
    const scenario = destructive();
    seedGenerated(repo(), model, scenario, { destructiveConfirmed: true });
    const plan = planRun(context({ profile: fullProfile({ destructivePermitted: true }) }), { items: [item(scenario)] });
    expect(plan.preview.problems).toEqual([]);
    expect(plan.preview.summary.destructive).toEqual([expect.objectContaining({ scenarioId: scenario.id, operationKey: "DELETE /orders/{orderId}", destructive: true })]);
  });
});

describe("budget arithmetic", () => {
  it("counts the planned requests of every scenario and refuses a plan above the limit, naming both numbers", () => {
    const a = pick(scenarios, "GET /orders", "auth.omit");
    const b = pick(scenarios, "GET /orders", "auth.invalid-token");
    const c = pick(scenarios, "GET /orders", "auth.malformed");
    for (const scenario of [a, b, c]) seedGenerated(repo(), model, scenario);
    const plan = planRun(context({ profile: fullProfile({ maxRequests: 2 }) }), { items: [item(a), item(b), item(c)] });
    expect(codes(plan)).toEqual(["budget_exceeded"]);
    expect(plan.preview.problems[0]).toMatchObject({ required: 3, allowed: 2 });
    const exactly = planRun(context({ profile: fullProfile({ maxRequests: 3 }) }), { items: [item(a), item(b), item(c)] });
    expect(exactly.preview.problems).toEqual([]);
  });

  it("counts a repeat scenario by its repeat count, not as one request", () => {
    const profile = fullProfile({ testData: [{ ownerIdentity: "alice", parameter: "rate-limit-threshold", value: "30" }] });
    // A rate-limit scenario exists only where the specification documents a 429, so document one on GET /orders.
    const limited = structuredClone(model);
    const orders = limited.operations.find((operation) => operation.method.toUpperCase() === "GET" && operation.path === "/orders");
    orders?.responses.push({ ...orders.responses[0], statusCode: "429" });
    const repeat = generatedScenarios(limited, profile).find((scenario) => scenario.content.mutations.some((mutation) => mutation.kind === "request.repeat"));
    if (!repeat) return expect.fail("No rate-limit scenario was generated");
    seedGenerated(repo(), limited, repeat);
    const plan = planRun(context({ profile, apiModel: limited }), { items: [item(repeat)] });
    expect(plan.preview.summary.plannedRequests).toBe(repeat.content.plannedRequestCount);
    expect(repeat.content.plannedRequestCount).toBeGreaterThan(1);
  });

  it("adds a cleanup request for a create that the specification documents a delete for, and only with the cleanup strategy", () => {
    const create = scenarios.find((scenario) => scenario.content.operationKey === "POST /orders");
    if (!create) return expect.fail("No scenario for POST /orders");
    seedGenerated(repo(), model, create, { destructiveConfirmed: true });
    const without = planRun(context({ profile: fullProfile({ destructivePermitted: true }) }), { items: [item(create)] });
    expect(without.preview.summary.cleanupRequests).toBe(0);
    const withCleanup = planRun(context({ profile: fullProfile({ destructivePermitted: true, cleanup: { strategy: "delete-created-via-spec", idField: "id" } }) }), { items: [item(create)] });
    expect(withCleanup.preview.summary.cleanupRequests).toBe(1);
    expect(withCleanup.preview.summary.plannedRequests).toBe(without.preview.summary.plannedRequests + 1);
    expect(withCleanup.planned[0].cleanupRequests).toBe(1);
  });

  it("counts cleanup against the limit", () => {
    const create = scenarios.find((scenario) => scenario.content.operationKey === "POST /orders");
    if (!create) return expect.fail("No scenario for POST /orders");
    seedGenerated(repo(), model, create, { destructiveConfirmed: true });
    const profile = fullProfile({ destructivePermitted: true, maxRequests: create.content.plannedRequestCount, cleanup: { strategy: "delete-created-via-spec", idField: "id" } });
    expect(codes(planRun(context({ profile }), { items: [item(create)] }))).toEqual(["budget_exceeded"]);
  });
});

describe("limit overrides", () => {
  const seeded = () => {
    const omit = pick(scenarios, "GET /orders", "auth.omit");
    seedGenerated(repo(), model, omit);
    return omit;
  };

  it("lets a run lower a limit and uses the lowered value", () => {
    const omit = seeded();
    const plan = planRun(context(), { items: [item(omit)], limits: { maxRequests: 10, timeoutMs: 2_000 } });
    expect(plan.preview.problems).toEqual([]);
    expect(plan.limits).toEqual({ maxRequests: 10, maxConcurrency: 1, timeoutMs: 2_000 });
  });

  it("refuses a limit above the profile's, and one that is not a positive integer", () => {
    const omit = seeded();
    expect(codes(planRun(context(), { items: [item(omit)], limits: { maxRequests: 101 } }))).toEqual(["limit_above_profile"]);
    expect(codes(planRun(context(), { items: [item(omit)], limits: { maxConcurrency: 2 } }))).toEqual(["limit_above_profile"]);
    for (const limits of [{ maxRequests: 0 }, { timeoutMs: 1.5 }, { maxRequests: "9" }, { surprise: 1 }, "text", []]) {
      expect(codes(planRun(context(), { items: [item(omit)], limits })), JSON.stringify(limits)).toEqual(["limit_invalid"]);
    }
  });

  it("is also bounded by the configured ceiling, not only by the profile", () => {
    const omit = seeded();
    const low = { ...loadSecurityLabLimits({}), ceilings: { ...loadSecurityLabLimits({}).ceilings, maxRequests: 5 } };
    expect(codes(planRun(context({ limits: low }), { items: [item(omit)], limits: { maxRequests: 6 } }))).toEqual(["limit_above_profile"]);
  });
});

describe("the plan digest binds a confirmation to a plan (FR-042)", () => {
  const digest = (overrides: Partial<PlannerContext> = {}, items?: GeneratedFixture[]) => {
    const chosen = items ?? [pick(scenarios, "GET /orders", "auth.omit"), pick(scenarios, "GET /orders", "auth.invalid-token")];
    for (const scenario of chosen) if (!repo().getScenario(OWNER_A, scenario.id)) seedGenerated(repo(), model, scenario);
    return planRun(context(overrides), { items: chosen.map((scenario) => item(scenario)) }).preview.planDigest;
  };

  it("is the same for the same plan, whatever the timestamps or the credential values", () => {
    const first = digest();
    expect(digest()).toBe(first);
    expect(digest({ profile: fullProfile({ createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2031-01-01T00:00:00.000Z" }) })).toBe(first);
    expect(digest({ credential: () => "a-different-value" })).toBe(first);
  });

  it.each([
    ["a host", { allowedHosts: ["127.0.0.1", "localhost"] }],
    ["a port", { allowedPorts: [4700, 4701] }],
    ["an address range", { allowedAddressRanges: ["127.0.0.1/32", "::1"] }],
    ["the TLS policy", { tlsPolicy: "relaxed-local" as const }],
    ["a limit", { timeoutMs: 9_000 }],
    ["the permitted categories", { permittedCategories: ["authentication"] }],
    ["the destructive flag", { destructivePermitted: true }],
    ["the cleanup strategy", { cleanup: { strategy: "delete-created-via-spec" as const, idField: "id" } }],
    ["an identity", { identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] }] }],
    ["test data", { testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "ord-2" }] }],
  ] as Array<[string, Partial<SecurityProfile>]>)("differs when %s of the profile changes", (_name, change) => {
    const base = digest();
    expect(digest({ profile: fullProfile(change) })).not.toBe(base);
  });

  it("differs when the target, the order, the scenario set, a scenario's content or the limits change", () => {
    const base = digest();
    expect(digest({ environment: { ...ENVIRONMENT, baseUrl: "http://127.0.0.1:4701" } })).not.toBe(base);
    expect(digest({ environment: { ...ENVIRONMENT, name: "Renamed" } })).not.toBe(base);
    expect(digest({ environment: { ...ENVIRONMENT, tier: "staging" } })).not.toBe(base);
    const [a, b] = [pick(scenarios, "GET /orders", "auth.omit"), pick(scenarios, "GET /orders", "auth.invalid-token")];
    expect(digest({}, [b, a])).not.toBe(base);
    expect(digest({}, [a])).not.toBe(base);
    const plan = planRun(context(), { items: [item(a), item(b)], limits: { maxRequests: 50 } });
    expect(plan.preview.planDigest).not.toBe(base);
  });

  it("is a pure function of its inputs", () => {
    const input = { profile: fullProfile(), environment: ENVIRONMENT, items: [{ id: "a", version: 1, contentHash: "h" }], limits: { maxRequests: 1, maxConcurrency: 1, timeoutMs: 1000 } };
    expect(computePlanDigest(input)).toBe(computePlanDigest(structuredClone(input)));
    expect(computePlanDigest({ ...input, items: [{ id: "a", version: 2, contentHash: "h" }] })).not.toBe(computePlanDigest(input));
    expect(computePlanDigest({ ...input, items: [{ id: "a", version: 1, contentHash: "other" }] })).not.toBe(computePlanDigest(input));
  });
});
