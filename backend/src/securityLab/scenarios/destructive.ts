import type { ApiOperation, SecurityMutation } from "@apipilot/shared-domain";
import { isStateChangingMethod } from "../analysis/sensitivity";

/**
 * The destructive-operation flag (specs/057 FR-033, contracts/generation-and-analysis-rules.md section 4). A
 * scenario is destructive when the request it sends could change data if the service wrongly accepts it: the
 * base operation changes state, or the scenario repeats a request or acts as another identity on one. Each cause
 * is named. The flag can be raised by an edit but never lowered (the validator enforces it), and a scenario that
 * creates data while the profile has no cleanup is raised again when a run is planned (FR-045).
 */
export function destructiveFor(
  operation: Pick<ApiOperation, "method">,
  mutations: readonly SecurityMutation[],
): { flag: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // A method probe sends TRACE, never the operation's own method, and TRACE does not change state.
  if (mutations.some((mutation) => mutation.kind === "method.probe")) return { flag: false, reasons };
  const method = operation.method.toUpperCase();
  if (isStateChangingMethod(method)) {
    reasons.push(`The operation is ${method}, which changes state if the service wrongly accepts the request.`);
  }
  if (mutations.some((mutation) => mutation.kind === "request.repeat") && isStateChangingMethod(method)) {
    reasons.push("The request is repeated, so a state change would be repeated too.");
  }
  return { flag: reasons.length > 0, reasons };
}
