import { describe, expect, it } from "vitest";
import { SECURITY_REVIEW_ACTIONS, SECURITY_REVIEW_STATES, type SecurityReviewAction, type SecurityReviewState } from "@apipilot/shared-domain";
import { allowedActions, nextExecutionStatus, nextReviewState } from "../../../src/securityLab/review/stateMachine";

/** The transitions of contracts/review-and-approval-rules.md, written out independently of the implementation. */
const ALLOWED: ReadonlyArray<[SecurityReviewState, SecurityReviewAction, SecurityReviewState]> = [
  ["draft", "submit", "in_review"],
  ["draft", "reject", "rejected"],
  ["in_review", "approve", "approved"],
  ["in_review", "reject", "rejected"],
  ["in_review", "withdraw", "draft"],
  ["approved", "withdraw", "in_review"],
  ["approved", "reject", "rejected"],
  ["rejected", "reopen", "in_review"],
];

describe("review state machine (FR-028)", () => {
  it.each(ALLOWED)("allows %s + %s -> %s", (from, action, to) => {
    expect(nextReviewState(from, action)).toBe(to);
  });

  it("refuses every other state and action pair", () => {
    const allowed = new Set(ALLOWED.map(([from, action]) => `${from}|${action}`));
    let refused = 0;
    for (const from of SECURITY_REVIEW_STATES) {
      for (const action of SECURITY_REVIEW_ACTIONS) {
        if (allowed.has(`${from}|${action}`)) continue;
        expect(nextReviewState(from, action), `${from} + ${action}`).toBeUndefined();
        refused += 1;
      }
    }
    expect(refused).toBe(SECURITY_REVIEW_STATES.length * SECURITY_REVIEW_ACTIONS.length - ALLOWED.length);
  });

  it("gives a rejected scenario exactly one way out, and no way to be approved directly", () => {
    expect(allowedActions("rejected")).toEqual(["reopen"]);
    expect(nextReviewState("rejected", "approve")).toBeUndefined();
    expect(nextReviewState("rejected", "submit")).toBeUndefined();
  });

  it("never reaches approved except from in review, so every approval follows a submission", () => {
    for (const from of SECURITY_REVIEW_STATES) {
      for (const action of SECURITY_REVIEW_ACTIONS) {
        if (nextReviewState(from, action) === "approved") expect([from, action]).toEqual(["in_review", "approve"]);
      }
    }
  });

  it("lists what a state allows, so the interface offers only what the service will accept", () => {
    expect(allowedActions("draft").sort()).toEqual(["reject", "submit"]);
    expect(allowedActions("in_review").sort()).toEqual(["approve", "reject", "withdraw"]);
    expect(allowedActions("approved").sort()).toEqual(["reject", "withdraw"]);
  });
});

describe("execution status (Executed, Evaluated)", () => {
  it("moves not run to executed to evaluated, and lets a rerun cycle back through executed", () => {
    expect(nextExecutionStatus("not_run", "executed")).toBe("executed");
    expect(nextExecutionStatus("executed", "evaluated")).toBe("evaluated");
    expect(nextExecutionStatus("evaluated", "executed")).toBe("executed");
    expect(nextExecutionStatus("evaluated", "evaluated")).toBe("evaluated");
  });

  it("never lets evaluation precede execution", () => {
    expect(nextExecutionStatus("not_run", "evaluated")).toBeUndefined();
  });

  it("allows a reset to not run, as a material edit does", () => {
    expect(nextExecutionStatus("evaluated", "not_run")).toBe("not_run");
  });
});
