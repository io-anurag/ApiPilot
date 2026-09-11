import type { ExecutionConfirmationRequirement } from "@apipilot/shared-domain";

/** `POST`/`PUT .../environments` referenced an `environmentId` absent from the session's store. */
export class EnvironmentNotFoundError extends Error {
  constructor(environmentId: string) {
    super(`No environment with id '${environmentId}' was found.`);
    this.name = "EnvironmentNotFoundError";
  }
}

/** `name` collides with an existing environment in this session (FR-003). */
export class DuplicateEnvironmentNameError extends Error {
  constructor(name: string) {
    super(`An environment named '${name}' already exists in this session.`);
    this.name = "DuplicateEnvironmentNameError";
  }
}

/** The selected environment does not supply every variable the approved collection declares (FR-004). */
export class MissingVariableValuesError extends Error {
  constructor(public readonly missing: string[]) {
    super(`The selected environment is missing a value for: ${missing.join(", ")}.`);
    this.name = "MissingVariableValuesError";
  }
}

/**
 * `execution/start` was refused because the selected environment's tier or the collection's
 * destructive operations require an explicit confirmation the request did not carry (FR-007).
 */
export class ConfirmationRequiredError extends Error {
  constructor(public readonly requirement: ExecutionConfirmationRequirement) {
    super("This execution requires explicit confirmation before it can start.");
    this.name = "ConfirmationRequiredError";
  }
}

/** `execution/start` was called while a run is already in progress for this session (FR-008). */
export class ExecutionInProgressError extends Error {
  constructor(public readonly runId: string) {
    super(`An execution run (${runId}) is already in progress for this session.`);
    this.name = "ExecutionInProgressError";
  }
}

/** `execution/cancel` was called with no run currently in progress. */
export class NoRunInProgressError extends Error {
  constructor() {
    super("No execution run is currently in progress.");
    this.name = "NoRunInProgressError";
  }
}

/** `GET .../execution/runs/:runId` named an id absent from this session's run history. */
export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No execution run with id '${runId}' was found.`);
    this.name = "RunNotFoundError";
  }
}
