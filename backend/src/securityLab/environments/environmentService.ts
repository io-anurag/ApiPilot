import type { Environment, EnvironmentTier, TargetEnvironment, TargetEnvironmentInput } from "@apipilot/shared-domain";
import {
  DuplicateEnvironmentNameError,
  EnvironmentNotFoundError,
} from "../../execution/errors";
import {
  createEnvironment,
  getEnvironment,
  listEnvironments,
  updateEnvironment,
} from "../../execution/environmentStore";
import { SecurityLabError, invalidRequest } from "../errors";

/**
 * The target half of a Security Lab profile (specs/057 research R8, revised). A profile's target is an
 * ordinary session-scoped environment, but these routes carry only `name`, `tier` and `baseUrl`: they never
 * accept or return `variableValues`, because the existing environment routes return those values to the browser
 * in plain text and Security Lab credentials must never be returned (FR-048). The existing environment gate
 * and routes are untouched. An edit keeps whatever variables the environment already holds.
 */

const TIERS: readonly EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];
const MAX_NAME_LENGTH = 100;

function toTarget(environment: Environment): TargetEnvironment {
  return { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl };
}

/**
 * Validates a request body into a target. The base URL must be an absolute http or https URL with no
 * credentials, so a secret can never be stored in it. Whether the destination is allowed is the destination
 * policy's decision, taken when a profile is saved and again on every request, not here.
 */
export function parseTargetInput(body: unknown): TargetEnvironmentInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidRequest("Request must be an object with 'name', 'tier' and 'baseUrl'.");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim() === "" || record.name.length > MAX_NAME_LENGTH) {
    throw invalidRequest(`'name' must be a non-empty string of at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (typeof record.tier !== "string" || !TIERS.includes(record.tier as EnvironmentTier)) {
    throw invalidRequest(`'tier' must be one of ${TIERS.join(", ")}.`);
  }
  if (typeof record.baseUrl !== "string") throw invalidRequest("'baseUrl' must be an absolute http or https URL.");
  let url: URL;
  try {
    url = new URL(record.baseUrl.trim());
  } catch {
    throw invalidRequest("'baseUrl' must be an absolute http or https URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalidRequest("'baseUrl' must use http or https.");
  if (url.username !== "" || url.password !== "") throw invalidRequest("'baseUrl' must not contain credentials.");
  return { name: record.name.trim(), tier: record.tier as EnvironmentTier, baseUrl: url.toString().replace(/\/$/, "") };
}

/** Translates the environment store's typed errors into Security Lab errors. */
function translate<T>(action: () => T): T {
  try {
    return action();
  } catch (err) {
    if (err instanceof EnvironmentNotFoundError) throw new SecurityLabError("environment_not_found", err.message);
    if (err instanceof DuplicateEnvironmentNameError) throw new SecurityLabError("duplicate_environment_name", err.message);
    throw err;
  }
}

export const environmentService = {
  list(): TargetEnvironment[] {
    return listEnvironments().map(toTarget);
  },

  get(id: string): TargetEnvironment {
    return toTarget(translate(() => getEnvironment(id)));
  },

  create(input: TargetEnvironmentInput): TargetEnvironment {
    return toTarget(
      translate(() => createEnvironment({ name: input.name, tier: input.tier, baseUrl: input.baseUrl, variableValues: {}, requestDelayMs: 0 })),
    );
  },

  /** Replaces name, tier and base URL, keeping the environment's variables and request delay as they are. */
  update(id: string, input: TargetEnvironmentInput): TargetEnvironment {
    const existing = translate(() => getEnvironment(id));
    return toTarget(
      translate(() =>
        updateEnvironment(id, {
          name: input.name,
          tier: input.tier,
          baseUrl: input.baseUrl,
          variableValues: existing.variableValues,
          requestDelayMs: existing.requestDelayMs,
        }),
      ),
    );
  },
};
