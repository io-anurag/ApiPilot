import { randomUUID } from "node:crypto";
import type { Environment } from "@apipilot/shared-domain";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { getEnvironmentRepository } from "../persistence/environmentRepository";
import { EnvironmentNotFoundError } from "./errors";

/**
 * Session-scoped `Environment` CRUD (research.md D3), mirroring
 * `testGenerationWorkflow/workflowStore.ts`'s `AsyncLocalStorage`-keyed session pattern
 * (specs/017-session-workflow-isolation). Durably backed by SQLite (specs/025-local-
 * persistence-layer research.md D4) — an environment survives a backend restart for as long as
 * its owning session remains active, and is removed when that session is idle-evicted, exactly
 * as before this feature.
 */

onExpire((sessionId) => {
  getEnvironmentRepository().deleteBySession(sessionId);
});

export interface EnvironmentInput {
  name: string;
  tier: Environment["tier"];
  baseUrl: string;
  variableValues: Record<string, string>;
  requestDelayMs: number;
}

export function listEnvironments(): Environment[] {
  return getEnvironmentRepository().list(getSessionId());
}

export function getEnvironment(environmentId: string): Environment {
  const environment = getEnvironmentRepository().get(getSessionId(), environmentId);
  if (!environment) throw new EnvironmentNotFoundError(environmentId);
  return environment;
}

/** Creates a new `Environment` for the calling session (FR-001, FR-002). Throws `DuplicateEnvironmentNameError` if `name` is already taken. */
export function createEnvironment(input: EnvironmentInput): Environment {
  return getEnvironmentRepository().create(getSessionId(), randomUUID(), input);
}

/** Replaces an existing environment's fields in place. Throws `EnvironmentNotFoundError`/`DuplicateEnvironmentNameError`. */
export function updateEnvironment(environmentId: string, input: EnvironmentInput): Environment {
  return getEnvironmentRepository().update(getSessionId(), environmentId, input);
}
