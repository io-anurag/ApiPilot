import type { ChainPlan, Environment } from "@apipilot/shared-domain";
import type { FailureResponseSettings } from "../live/failureSamples";

/**
 * What the live view must hide in a failed request's response (AP-049). Secret environment values
 * are masked wherever they appear. A plan with a secret data set column gets no response text at all:
 * its values are read from files for every row, so they cannot all be known here, and an error
 * response could echo one back.
 */
export function failureResponseSettings(plan: Pick<ChainPlan, "secretNames" | "dataSets">, environment: Pick<Environment, "variableValues">): FailureResponseSettings {
  const secrets = plan.secretNames.flatMap((name) => {
    const value = environment.variableValues[name];
    return value ? [{ name, value, kind: "environment" as const }] : [];
  });
  const withhold = plan.dataSets.some((dataSet) => dataSet.columns.some((column) => column.secret));
  return { secrets, withhold };
}
