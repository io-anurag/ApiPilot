import { describe, expect, it } from "vitest";
import type { SecurityReviewState } from "@apipilot/shared-domain";
import { getSecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { EDITABLE_FIELDS, ScenarioInvalidError, editScenario, reviewItems } from "../../../src/securityLab/review/reviewService";
import { OWNER_A, OWNER_B } from "../../fixtures/securityLab/builders";
import { loadSecurityFixtureModel } from "../../fixtures/securityLab/loadModel";
import { reviewContext, seedScenario } from "../../fixtures/securityLab/seed";

const repo = () => getSecurityScenarioRepository();

function seed(id: string, reviewState: SecurityReviewState = "in_review", destructive = false) {
  return seedScenario(repo(), {
    id,
    reviewState,
    content: destructive
      ? { operationKey: "POST /orders", operationMethod: "POST", operationPath: "/orders", destructive: { flag: true, reasons: ["POST"] } }
      : {},
  });
}

describe("batch review names its items explicitly (FR-031, FR-032)", () => {
  it("applies the action to each listed item and reports each outcome in the order given", () => {
    seed("ss-a");
    seed("ss-b");
    seed("ss-c");
    const outcomes = reviewItems(reviewContext(repo()), OWNER_A, {
      action: "approve",
      items: [
        { id: "ss-c", version: 1 },
        { id: "ss-a", version: 1 },
        { id: "ss-b", version: 1 },
      ],
    });
    expect(outcomes.map((outcome) => outcome.id)).toEqual(["ss-c", "ss-a", "ss-b"]);
    expect(outcomes.every((outcome) => outcome.applied && outcome.reviewState === "approved")).toBe(true);
  });

  it("changes only the scenarios named, never one the caller did not list", () => {
    seed("ss-a");
    seed("ss-b");
    reviewItems(reviewContext(repo()), OWNER_A, { action: "approve", items: [{ id: "ss-a", version: 1 }] });
    expect(repo().getScenario(OWNER_A, "ss-a")?.reviewState).toBe("approved");
    expect(repo().getScenario(OWNER_A, "ss-b")?.reviewState).toBe("in_review");
  });

  it("reports a partial application as one: each item succeeds or is refused on its own, with a code", () => {
    seed("ss-ok");
    seed("ss-draft", "draft");
    seed("ss-destructive", "in_review", true);
    const outcomes = reviewItems(reviewContext(repo()), OWNER_A, {
      action: "approve",
      items: [
        { id: "ss-ok", version: 1 },
        { id: "ss-missing", version: 1 },
        { id: "ss-draft", version: 1 },
        { id: "ss-ok", version: 2 },
        { id: "ss-destructive", version: 1 },
      ],
    });
    expect(outcomes.map((o) => [o.id, o.applied, o.reasonCode])).toEqual([
      ["ss-ok", true, undefined],
      ["ss-missing", false, "scenario_not_found"],
      ["ss-draft", false, "invalid_transition"],
      ["ss-ok", false, "stale_version"],
      ["ss-destructive", false, "destructive_confirmation_required"],
    ]);
    for (const refused of outcomes.filter((o) => !o.applied)) expect(refused.message?.length).toBeGreaterThan(10);
  });

  it("does not let one refusal stop the items after it", () => {
    seed("ss-a");
    seed("ss-b");
    const outcomes = reviewItems(reviewContext(repo()), OWNER_A, {
      action: "approve",
      items: [{ id: "ss-nope", version: 1 }, { id: "ss-a", version: 1 }, { id: "ss-b", version: 1 }],
    });
    expect(outcomes.map((o) => o.applied)).toEqual([false, true, true]);
  });

  it("keeps each owner's scenarios apart, even for an id both hold", () => {
    seedScenario(repo(), { id: "ss-same", ownerId: OWNER_A, reviewState: "in_review" });
    seedScenario(repo(), { id: "ss-same", ownerId: OWNER_B, reviewState: "in_review" });
    reviewItems(reviewContext(repo()), OWNER_A, { action: "approve", items: [{ id: "ss-same", version: 1 }] });
    expect(repo().getScenario(OWNER_A, "ss-same")?.reviewState).toBe("approved");
    expect(repo().getScenario(OWNER_B, "ss-same")?.reviewState).toBe("in_review");
    const [other] = reviewItems(reviewContext(repo()), OWNER_B, { action: "approve", items: [{ id: "ss-nobody", version: 1 }] });
    expect(other.reasonCode).toBe("scenario_not_found");
  });
});

describe("destructive scenarios (FR-033)", () => {
  it("are approved only when each is named, and a name for one does not cover another", () => {
    seed("ss-d1", "in_review", true);
    seed("ss-d2", "in_review", true);
    const outcomes = reviewItems(reviewContext(repo()), OWNER_A, {
      action: "approve",
      items: [{ id: "ss-d1", version: 1 }, { id: "ss-d2", version: 1 }],
      destructiveConfirmations: ["ss-d1"],
    });
    expect(outcomes.map((o) => [o.id, o.applied])).toEqual([["ss-d1", true], ["ss-d2", false]]);
    expect(outcomes[1].reasonCode).toBe("destructive_confirmation_required");
  });

  it("can still be submitted, rejected or withdrawn without a confirmation, because those send nothing", () => {
    seed("ss-d", "draft", true);
    const ctx = reviewContext(repo());
    expect(reviewItems(ctx, OWNER_A, { action: "submit", items: [{ id: "ss-d", version: 1 }] })[0].applied).toBe(true);
    expect(reviewItems(ctx, OWNER_A, { action: "reject", items: [{ id: "ss-d", version: 1 }], reason: "not now" })[0].applied).toBe(true);
  });
});

describe("rejection and reasons", () => {
  it("needs a reason, and refuses a blank one", () => {
    seed("ss-a");
    for (const reason of [undefined, "", "   "]) {
      const [outcome] = reviewItems(reviewContext(repo()), OWNER_A, { action: "reject", items: [{ id: "ss-a", version: 1 }], reason });
      expect(outcome).toMatchObject({ applied: false, reasonCode: "reason_required" });
    }
    expect(repo().getScenario(OWNER_A, "ss-a")?.reviewState).toBe("in_review");
  });

  it("stores the trimmed reason against the rejected version", () => {
    seed("ss-a");
    reviewItems(reviewContext(repo()), OWNER_A, { action: "reject", items: [{ id: "ss-a", version: 1 }], reason: "  Not applicable  " });
    expect(repo().getVersion(OWNER_A, "ss-a", 1)?.rejection?.reason).toBe("Not applicable");
  });
});

describe("a changed or missing specification (spec edge cases)", () => {
  const stale = { stale: true };
  const orphaned = { orphaned: true };
  const notLoaded = { specificationNotLoaded: true };

  it.each([
    ["stale", stale, /operation changed/],
    ["orphaned", orphaned, /no longer in the specification/],
    ["with no specification loaded", notLoaded, /No specification is loaded/],
  ])("refuses to submit, approve or reopen a scenario that is %s", (_name, flags, message) => {
    for (const [action, state] of [["submit", "draft"], ["approve", "in_review"], ["reopen", "rejected"]] as const) {
      const id = `ss-${action}`;
      seed(id, state);
      const [outcome] = reviewItems(reviewContext(repo(), flags), OWNER_A, { action, items: [{ id, version: 1 }], reason: "x" });
      expect(outcome, action).toMatchObject({ applied: false, reasonCode: "not_executable_content" });
      expect(outcome.message).toMatch(message);
      expect(repo().getScenario(OWNER_A, id)?.reviewState).toBe(state);
    }
  });

  it("still lets the engineer reject or withdraw such a scenario, because nothing is sent", () => {
    seed("ss-reject", "in_review");
    seed("ss-withdraw", "approved");
    const ctx = reviewContext(repo(), { stale: true });
    expect(reviewItems(ctx, OWNER_A, { action: "reject", items: [{ id: "ss-reject", version: 1 }], reason: "outdated" })[0].applied).toBe(true);
    expect(reviewItems(ctx, OWNER_A, { action: "withdraw", items: [{ id: "ss-withdraw", version: 1 }] })[0].applied).toBe(true);
  });

  it("judges each scenario by its own flags within one batch", () => {
    seed("ss-fresh");
    seed("ss-old");
    const ctx = reviewContext(repo(), (scenario) => (scenario.id === "ss-old" ? { stale: true } : {}));
    const outcomes = reviewItems(ctx, OWNER_A, { action: "approve", items: [{ id: "ss-fresh", version: 1 }, { id: "ss-old", version: 1 }] });
    expect(outcomes.map((o) => o.applied)).toEqual([true, false]);
  });
});

describe("edit rules (FR-030)", () => {
  it("lists exactly the editable fields and refuses any other, including the operation and the category", () => {
    expect([...EDITABLE_FIELDS]).toEqual([
      "title", "objective", "rationale", "impact", "suggestedSeverity", "limitations", "manualInputs", "baseRequest",
      "mutations", "expected", "conditions", "plannedRequestCount", "requiredIdentities", "prerequisites", "destructive",
    ]);
    seed("ss-a", "draft");
    for (const field of ["operationKey", "categoryId", "taxonomy", "provenance", "unknownField"]) {
      expect(() => editScenario(reviewContext(repo()), OWNER_A, "ss-a", { expectedVersion: 1, changes: { [field]: "x" } }, { maxRepeat: 50 })).toThrow(
        expect.objectContaining({ code: "invalid_request" }),
      );
    }
    expect(repo().listVersions(OWNER_A, "ss-a")).toHaveLength(1);
  });

  it("refuses an empty edit", () => {
    seed("ss-a", "draft");
    expect(() => editScenario(reviewContext(repo()), OWNER_A, "ss-a", { expectedVersion: 1, changes: {} }, { maxRepeat: 50 })).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("refuses an edit made against an older version, naming the current one", () => {
    seed("ss-a", "draft");
    editScenario(reviewContext(repo()), OWNER_A, "ss-a", { expectedVersion: 1, changes: { title: "Second" } }, { maxRepeat: 50 });
    let caught: unknown;
    try {
      editScenario(reviewContext(repo()), OWNER_A, "ss-a", { expectedVersion: 1, changes: { title: "Third" } }, { maxRepeat: 50 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "stale_version", statusCode: 409, details: { currentVersion: 2 } });
  });

  it("refuses to edit a rejected scenario until it is reopened", () => {
    seed("ss-a", "rejected");
    expect(() => editScenario(reviewContext(repo()), OWNER_A, "ss-a", { expectedVersion: 1, changes: { title: "x" } }, { maxRepeat: 50 })).toThrow(
      expect.objectContaining({ code: "scenario_rejected" }),
    );
  });

  it("never lowers the destructive flag by an edit", async () => {
    const model = await loadSecurityFixtureModel("sample-api.yaml");
    seedScenario(repo(), { id: "ss-d", reviewState: "draft", content: { operationKey: "POST /orders", operationMethod: "POST", operationPath: "/orders", destructive: { flag: true, reasons: ["POST"] } } });
    let caught: unknown;
    try {
      editScenario(reviewContext(repo()), OWNER_A, "ss-d", { expectedVersion: 1, changes: { destructive: { flag: false, reasons: [] } } }, { maxRepeat: 50, apiModel: model });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ScenarioInvalidError);
    expect((caught as ScenarioInvalidError).violations.map((violation) => violation.code)).toContain("destructive_flag_lowered");
    expect(repo().listVersions(OWNER_A, "ss-d")).toHaveLength(1);
  });

  it("allows a draft to be edited without moving it to another state", () => {
    seed("ss-a", "draft");
    const result = editScenario(reviewContext(repo()), OWNER_A, "ss-a", { expectedVersion: 1, changes: { limitations: ["A note"] } }, { maxRepeat: 50 });
    expect(result).toMatchObject({ material: false, reviewState: "draft" });
  });
});
