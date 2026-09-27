import type {
  Environment,
  PerformanceJourney,
  UserSuppliedValueRequirement,
  UserSuppliedValueSource,
  UserSuppliedValueStatus,
} from "@apipilot/shared-domain";
import { BASE_URL_VARIABLE } from "../../postman/artifactVariables";
import { compareCodeUnits } from "../../postman/ordering";
import type { AuthPlan, BuiltStepRequest } from "./stepRequest";

/**
 * FR-013 (specs/031-k6-performance-testing research D6): every value the specification cannot
 * produce, derived from the same request builders that give Postman its variables. The plan
 * records names only; the values are the target environment's `variableValues` (encrypted by
 * AP-025) and are judged present per environment, never returned.
 */
export function listUserSuppliedValues(
  journeys: PerformanceJourney[],
  requests: ReadonlyMap<string, BuiltStepRequest>,
  auth: AuthPlan,
): UserSuppliedValueRequirement[] {
  const oauth2ClientNames = new Set<string>();
  for (const entry of auth.schemePlan.values()) {
    if (entry.type === "oauth2") {
      oauth2ClientNames.add(entry.variableNames.clientId);
      oauth2ClientNames.add(entry.variableNames.clientSecret);
    }
  }

  const byName = new Map<string, UserSuppliedValueRequirement>();
  for (const step of journeys.flatMap((journey) => journey.steps)) {
    const built = requests.get(step.id);
    for (const name of step.requiredValues) {
      let source: UserSuppliedValueSource = "credential";
      if (name === BASE_URL_VARIABLE) source = "base-url";
      else if (built?.pathParameterNames.includes(name)) source = "path-parameter";
      else if (oauth2ClientNames.has(name)) source = "oauth2-client";
      const secret = source === "oauth2-client" || source === "credential" || (built?.secretNames.has(name) ?? false);
      const existing = byName.get(name);
      if (existing) {
        if (!existing.neededBySteps.includes(step.id)) existing.neededBySteps.push(step.id);
        existing.secret = existing.secret || secret;
      } else {
        byName.set(name, { name, secret: source === "path-parameter" || source === "base-url" ? false : secret, neededBySteps: [step.id], source });
      }
    }
  }
  return [...byName.values()].sort((a, b) => compareCodeUnits(a.name, b.name));
}

/** Presence of each requirement in one environment. Never the value (FR-013). */
export function valueStatuses(
  requirements: readonly UserSuppliedValueRequirement[],
  environment: Pick<Environment, "baseUrl" | "variableValues">,
): UserSuppliedValueStatus[] {
  return requirements.map((requirement) => ({
    ...requirement,
    neededBySteps: [...requirement.neededBySteps],
    present:
      requirement.name === BASE_URL_VARIABLE
        ? environment.baseUrl.trim().length > 0
        : (environment.variableValues[requirement.name] ?? "").length > 0,
  }));
}
