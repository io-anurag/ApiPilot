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
function sourceOf(name: string, built: BuiltStepRequest | undefined, oauth2ClientNames: ReadonlySet<string>): UserSuppliedValueSource {
  if (name === BASE_URL_VARIABLE) return "base-url";
  if (built?.pathParameterNames.includes(name)) return "path-parameter";
  if (oauth2ClientNames.has(name)) return "oauth2-client";
  // AP-033 (specs/033 research R4): a name only the engineer's edited body refers to.
  if (built?.bodyReferenceNames?.includes(name)) return "body-reference";
  return "credential";
}

function isSecret(name: string, source: UserSuppliedValueSource, built: BuiltStepRequest | undefined): boolean {
  if (source === "oauth2-client" || source === "credential") return true;
  return (built?.secretNames.has(name) ?? false) || (built?.bodySecretReferenceNames?.includes(name) ?? false);
}

function oauth2ClientNamesOf(auth: AuthPlan): Set<string> {
  const names = new Set<string>();
  for (const entry of auth.schemePlan.values()) {
    if (entry.type === "oauth2") {
      names.add(entry.variableNames.clientId);
      names.add(entry.variableNames.clientSecret);
    }
  }
  return names;
}

export function listUserSuppliedValues(
  journeys: PerformanceJourney[],
  requests: ReadonlyMap<string, BuiltStepRequest>,
  auth: AuthPlan,
): UserSuppliedValueRequirement[] {
  const oauth2ClientNames = oauth2ClientNamesOf(auth);
  const byName = new Map<string, UserSuppliedValueRequirement>();
  for (const step of journeys.flatMap((journey) => journey.steps)) {
    const built = requests.get(step.id);
    for (const name of step.requiredValues) {
      const source = sourceOf(name, built, oauth2ClientNames);
      const secret = isSecret(name, source, built);
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
