import { randomUUID } from "node:crypto";
import type { Environment } from "@apipilot/shared-domain";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { DuplicateEnvironmentNameError, EnvironmentNotFoundError } from "./errors";

/**
 * Session-scoped `Environment` CRUD (research.md D3), mirroring
 * `testGenerationWorkflow/workflowStore.ts`'s `AsyncLocalStorage`-keyed `Map` pattern
 * (specs/017-session-workflow-isolation). No durable persistence: an environment lives only for
 * its session's lifetime.
 */

const sessionEnvironments = new Map<string, Environment[]>();

onExpire((sessionId) => {
  sessionEnvironments.delete(sessionId);
});

function getEnvironments(): Environment[] {
  const sessionId = getSessionId();
  let environments = sessionEnvironments.get(sessionId);
  if (!environments) {
    environments = [];
    sessionEnvironments.set(sessionId, environments);
  }
  return environments;
}

/** Test-only hook to clear every session's environments between test runs. */
export function resetEnvironmentStore(): void {
  sessionEnvironments.clear();
}

export function listEnvironments(): Environment[] {
  return getEnvironments();
}

export function getEnvironment(environmentId: string): Environment {
  const environment = getEnvironments().find((e) => e.id === environmentId);
  if (!environment) throw new EnvironmentNotFoundError(environmentId);
  return environment;
}

function assertNameAvailable(environments: Environment[], name: string, excludeId?: string): void {
  if (environments.some((e) => e.name === name && e.id !== excludeId)) {
    throw new DuplicateEnvironmentNameError(name);
  }
}

export interface EnvironmentInput {
  name: string;
  tier: Environment["tier"];
  baseUrl: string;
  variableValues: Record<string, string>;
  requestDelayMs: number;
}

/** Creates a new `Environment` for the calling session (FR-001, FR-002). Throws `DuplicateEnvironmentNameError` if `name` is already taken. */
export function createEnvironment(input: EnvironmentInput): Environment {
  const environments = getEnvironments();
  assertNameAvailable(environments, input.name);
  const environment: Environment = { id: randomUUID(), ...input };
  environments.push(environment);
  return environment;
}

/** Replaces an existing environment's fields in place. Throws `EnvironmentNotFoundError`/`DuplicateEnvironmentNameError`. */
export function updateEnvironment(environmentId: string, input: EnvironmentInput): Environment {
  const environments = getEnvironments();
  const index = environments.findIndex((e) => e.id === environmentId);
  if (index === -1) throw new EnvironmentNotFoundError(environmentId);
  assertNameAvailable(environments, input.name, environmentId);
  const updated: Environment = { id: environmentId, ...input };
  environments[index] = updated;
  return updated;
}
