import { describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getSecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { ScenarioInvalidError, editScenario, hasLiveApproval, reviewItems, type EditEnvironment } from "../../../src/securityLab/review/reviewService";
import { contentHashOf } from "../../../src/securityLab/scenarios/scenarioIdentity";
import { OWNER_A, T1, makeContent } from "../../fixtures/securityLab/builders";
import { reviewContext, seedScenario } from "../../fixtures/securityLab/seed";
import { loadSecurityFixtureModel } from "../../fixtures/securityLab/loadModel";

const ID = "ss-0000000000000001";
const NO_MODEL: EditEnvironment = { maxRepeat: 50 };

function approved(repo = getSecurityScenarioRepository()) {
  seedScenario(repo, { reviewState: "in_review" });
  const context = reviewContext(repo, {}, T1);
  const [outcome] = reviewItems(context, OWNER_A, { action: "approve", items: [{ id: ID, version: 1 }] });
  expect(outcome.applied).toBe(true);
  return { repo, context };
}

describe("approval is bound to a version and its content (FR-030, SC-010)", () => {
  it("records the version, its content hash, the actor and the time", () => {
    const { repo } = approved();
    const version = repo.getVersion(OWNER_A, ID, 1);
    expect(version?.approval).toEqual({
      version: 1,
      contentHash: contentHashOf(makeContent()),
      approvedAt: T1,
      actor: "tester",
      destructiveConfirmed: false,
    });
    expect(hasLiveApproval(version!)).toBe(true);
    expect(repo.getScenario(OWNER_A, ID)?.reviewState).toBe("approved");
  });

  it("refuses to approve a version that is not the current one", () => {
    const repo = getSecurityScenarioRepository();
    seedScenario(repo, { reviewState: "in_review" });
    const [outcome] = reviewItems(reviewContext(repo), OWNER_A, { action: "approve", items: [{ id: ID, version: 7 }] });
    expect(outcome).toMatchObject({ applied: false, reasonCode: "stale_version" });
    expect(repo.getScenario(OWNER_A, ID)?.reviewState).toBe("in_review");
  });

  it("refuses to approve content that no longer matches its hash", () => {
    const repo = getSecurityScenarioRepository();
    seedScenario(repo, { reviewState: "in_review" });
    // Corrupt the stored content out from under its hash, as a bad write or tampering would.
    const version = repo.getVersion(OWNER_A, ID, 1)!;
    const tampered = { ...version.content, mutations: [{ kind: "auth.malformed" as const }] };
    getSharedConnection()
      .db.prepare("UPDATE security_scenario_versions SET content = ? WHERE owner_id = ? AND scenario_id = ? AND version = 1")
      .run(JSON.stringify(tampered), OWNER_A, ID);
    const [outcome] = reviewItems(reviewContext(repo), OWNER_A, { action: "approve", items: [{ id: ID, version: 1 }] });
    expect(outcome).toMatchObject({ applied: false, reasonCode: "not_executable_content" });
    expect(outcome.message).toMatch(/does not match its hash/);
  });

  it("does not treat a withdrawn approval as live, and keeps the record with its withdrawal time", () => {
    const { repo } = approved();
    const [withdrawn] = reviewItems(reviewContext(repo, {}, "2026-02-02T00:00:00.000Z"), OWNER_A, { action: "withdraw", items: [{ id: ID, version: 1 }] });
    expect(withdrawn).toMatchObject({ applied: true, reviewState: "in_review" });
    const version = repo.getVersion(OWNER_A, ID, 1)!;
    expect(version.approval?.withdrawnAt).toBe("2026-02-02T00:00:00.000Z");
    expect(version.approval?.approvedAt).toBe(T1);
    expect(hasLiveApproval(version)).toBe(false);
  });

  it("withdraws the approval when an approved scenario is rejected, keeping the rejection reason", () => {
    const { repo } = approved();
    const [rejected] = reviewItems(reviewContext(repo, {}, "2026-03-03T00:00:00.000Z"), OWNER_A, { action: "reject", items: [{ id: ID, version: 1 }], reason: "Out of scope" });
    expect(rejected).toMatchObject({ applied: true, reviewState: "rejected" });
    const version = repo.getVersion(OWNER_A, ID, 1)!;
    expect(version.rejection).toEqual({ reason: "Out of scope", at: "2026-03-03T00:00:00.000Z" });
    expect(hasLiveApproval(version)).toBe(false);
  });

  it("makes a rejected scenario approvable again only by reopening and reviewing it", () => {
    const { repo } = approved();
    const ctx = reviewContext(repo);
    reviewItems(ctx, OWNER_A, { action: "reject", items: [{ id: ID, version: 1 }], reason: "no" });
    const [direct] = reviewItems(ctx, OWNER_A, { action: "approve", items: [{ id: ID, version: 1 }] });
    expect(direct).toMatchObject({ applied: false, reasonCode: "invalid_transition" });
    const [reopened] = reviewItems(ctx, OWNER_A, { action: "reopen", items: [{ id: ID, version: 1 }] });
    expect(reopened).toMatchObject({ applied: true, reviewState: "in_review" });
    expect(repo.getVersion(OWNER_A, ID, 1)?.rejection).toBeUndefined();
    expect(hasLiveApproval(repo.getVersion(OWNER_A, ID, 1)!)).toBe(false);
  });

  it("requires a destructive scenario to be named in the confirmation list", () => {
    const repo = getSecurityScenarioRepository();
    seedScenario(repo, { reviewState: "in_review", content: { operationKey: "POST /orders", operationMethod: "POST", operationPath: "/orders", destructive: { flag: true, reasons: ["POST"] } } });
    const ctx = reviewContext(repo);
    const [without] = reviewItems(ctx, OWNER_A, { action: "approve", items: [{ id: ID, version: 1 }] });
    expect(without).toMatchObject({ applied: false, reasonCode: "destructive_confirmation_required" });
    const [other] = reviewItems(ctx, OWNER_A, { action: "approve", items: [{ id: ID, version: 1 }], destructiveConfirmations: ["ss-something-else"] });
    expect(other.applied).toBe(false);
    const [named] = reviewItems(ctx, OWNER_A, { action: "approve", items: [{ id: ID, version: 1 }], destructiveConfirmations: [ID] });
    expect(named.applied).toBe(true);
    expect(repo.getVersion(OWNER_A, ID, 1)?.approval?.destructiveConfirmed).toBe(true);
  });
});

describe("edits keep or withdraw approval by whether they are material (FR-030)", () => {
  it("returns an approved scenario to review on a material edit, as a new version, and the earlier approval applies to the earlier version only", async () => {
    const { repo, context } = approved();
    const model = await loadSecurityFixtureModel("sample-api.yaml");
    const result = editScenario(context, OWNER_A, ID, { expectedVersion: 1, changes: { mutations: [{ kind: "auth.malformed" }] }, note: "Use a malformed credential" }, { ...NO_MODEL, apiModel: model, basisHash: "basis-2", specificationRevision: "rev-2" });
    expect(result).toEqual({ scenarioId: ID, version: 2, material: true, reviewState: "in_review" });

    const v1 = repo.getVersion(OWNER_A, ID, 1)!;
    const v2 = repo.getVersion(OWNER_A, ID, 2)!;
    expect(hasLiveApproval(v1)).toBe(true);
    expect(v1.approval?.version).toBe(1);
    expect(v2.approval).toBeUndefined();
    expect(hasLiveApproval(v2)).toBe(false);
    expect(v2).toMatchObject({ author: "user", materialChange: true, editNote: "Use a malformed credential", securityBasisHash: "basis-2", specificationRevision: "rev-2" });
    expect(repo.getScenario(OWNER_A, ID)).toMatchObject({ currentVersion: 2, reviewState: "in_review", executionStatus: "not_run" });
  });

  it("keeps the approval on a non-material edit, carrying it to the new version with its original time and actor", () => {
    const { repo, context } = approved();
    const result = editScenario(context, OWNER_A, ID, { expectedVersion: 1, changes: { title: "A clearer title", suggestedSeverity: "medium" }, note: "Reworded" }, NO_MODEL);
    expect(result).toMatchObject({ version: 2, material: false, reviewState: "approved" });
    const v2 = repo.getVersion(OWNER_A, ID, 2)!;
    expect(v2.materialChange).toBe(false);
    expect(v2.approval).toMatchObject({ version: 2, contentHash: v2.contentHash, approvedAt: T1, actor: "tester", carriedFromVersion: 1 });
    expect(hasLiveApproval(v2)).toBe(true);
    expect(repo.getScenario(OWNER_A, ID)).toMatchObject({ reviewState: "approved", title: "A clearer title", severity: "medium" });
  });

  it("does not carry an approval to a version it was not given for: only the approved version is live", async () => {
    const { repo, context } = approved();
    const model = await loadSecurityFixtureModel("sample-api.yaml");
    editScenario(context, OWNER_A, ID, { expectedVersion: 1, changes: { mutations: [{ kind: "auth.invalid-token" }] } }, { ...NO_MODEL, apiModel: model });
    const live = repo.listVersions(OWNER_A, ID).filter((version) => hasLiveApproval(version)).map((version) => version.version);
    expect(live).toEqual([1]);
    expect(repo.getScenario(OWNER_A, ID)?.currentVersion).toBe(2);
  });

  it("refuses a material edit while no specification is loaded, and changes nothing", () => {
    const { repo, context } = approved();
    expect(() => editScenario(context, OWNER_A, ID, { expectedVersion: 1, changes: { mutations: [{ kind: "auth.malformed" }] } }, NO_MODEL)).toThrow(
      expect.objectContaining({ code: "no_specification" }),
    );
    expect(repo.listVersions(OWNER_A, ID)).toHaveLength(1);
    expect(repo.getScenario(OWNER_A, ID)).toMatchObject({ currentVersion: 1, reviewState: "approved" });
  });

  it("refuses an invalid edit with every violation, and stores no new version", async () => {
    const { repo, context } = approved();
    const model = await loadSecurityFixtureModel("sample-api.yaml");
    let caught: unknown;
    try {
      editScenario(context, OWNER_A, ID, { expectedVersion: 1, changes: { rationale: "Send it to http://evil.example", mutations: [{ kind: "path-id.substitute", parameter: "nope", ownerIdentity: "owner" }] } }, { ...NO_MODEL, apiModel: model });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ScenarioInvalidError);
    expect((caught as ScenarioInvalidError).violations.map((violation) => violation.code).sort()).toEqual(["unknown_field", "url_in_content"]);
    expect((caught as ScenarioInvalidError).statusCode).toBe(422);
    expect(repo.listVersions(OWNER_A, ID)).toHaveLength(1);
  });

  it("never edits version 1: the generated original stays exactly as it was across any number of edits", async () => {
    const { repo, context } = approved();
    const model = await loadSecurityFixtureModel("sample-api.yaml");
    const original = JSON.stringify(repo.getVersion(OWNER_A, ID, 1)?.content);
    editScenario(context, OWNER_A, ID, { expectedVersion: 1, changes: { title: "Second" } }, NO_MODEL);
    editScenario(context, OWNER_A, ID, { expectedVersion: 2, changes: { mutations: [{ kind: "auth.malformed" }] } }, { ...NO_MODEL, apiModel: model });
    expect(JSON.stringify(repo.getVersion(OWNER_A, ID, 1)?.content)).toBe(original);
    expect(repo.listVersions(OWNER_A, ID).map((version) => [version.version, version.author, version.materialChange])).toEqual([
      [1, "generator", false],
      [2, "user", false],
      [3, "user", true],
    ]);
  });

});
