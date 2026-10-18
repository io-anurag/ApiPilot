import type { ExecutionStatus, SecurityReviewAction, SecurityReviewState } from "@apipilot/shared-domain";

/**
 * The review lifecycle as a pure transition table (specs/057 FR-028, contracts/review-and-approval-rules.md
 * "Transitions"). Enforced by the service, never only by the interface. Draft, In review, Approved, Executed and
 * Evaluated is the lifecycle a person sees: the first three are `reviewState`, the last two `executionStatus`.
 * Rejected is a side state from which a scenario cannot run until it is reopened.
 */

const TRANSITIONS: Readonly<Record<SecurityReviewState, Partial<Record<SecurityReviewAction, SecurityReviewState>>>> = {
  draft: { submit: "in_review", reject: "rejected" },
  in_review: { approve: "approved", reject: "rejected", withdraw: "draft" },
  approved: { withdraw: "in_review", reject: "rejected" },
  rejected: { reopen: "in_review" },
};

/** The state `action` leads to from `from`, or `undefined` when the transition is not allowed. */
export function nextReviewState(from: SecurityReviewState, action: SecurityReviewAction): SecurityReviewState | undefined {
  return TRANSITIONS[from][action];
}

/** Actions allowed from a state, for the interface to offer only what the service will accept. */
export function allowedActions(from: SecurityReviewState): SecurityReviewAction[] {
  return Object.keys(TRANSITIONS[from]) as SecurityReviewAction[];
}

/**
 * The execution status after a step of a run. `not_run → executed → evaluated`, and a rerun of an evaluated scenario
 * cycles `executed → evaluated` again; nothing else is allowed, so evaluation can never precede execution.
 */
export function nextExecutionStatus(from: ExecutionStatus, to: ExecutionStatus): ExecutionStatus | undefined {
  if (to === "executed") return "executed";
  if (to === "evaluated" && (from === "executed" || from === "evaluated")) return "evaluated";
  if (to === "not_run") return "not_run";
  return undefined;
}
