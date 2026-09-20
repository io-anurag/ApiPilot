import type { ExecutionConfirmationRequirement } from "@apipilot/shared-domain";

/** `:id` in an `/api/external-collections/...` route does not match any uploaded collection in this session. */
export class UploadedCollectionNotFoundError extends Error {
  constructor(id: string) {
    super(`No uploaded collection with id '${id}' was found.`);
    this.name = "UploadedCollectionNotFoundError";
  }
}

/** `name` collides with an existing uploaded collection in this session (FR-016). */
export class DuplicateNameError extends Error {
  constructor(name: string) {
    super(`An uploaded collection named '${name}' already exists in this session.`);
    this.name = "DuplicateNameError";
  }
}

/** The uploaded `collection` file is not well-formed Postman Collection v2.1 JSON (FR-002). */
export class InvalidCollectionError extends Error {
  constructor(reason: string) {
    super(`The uploaded collection is invalid: ${reason}`);
    this.name = "InvalidCollectionError";
  }
}

/** The uploaded `environment` file is not well-formed Postman Environment JSON (FR-003). */
export class InvalidEnvironmentError extends Error {
  constructor(reason: string) {
    super(`The uploaded environment is invalid: ${reason}`);
    this.name = "InvalidEnvironmentError";
  }
}

/** The uploaded environment does not supply a value for every variable the collection references (FR-004). */
export class MissingVariableValuesError extends Error {
  constructor(public readonly missing: string[]) {
    super(`The uploaded environment is missing a value for: ${missing.join(", ")}.`);
    this.name = "MissingVariableValuesError";
  }
}

/** `execution/start` was refused because gate 1 (FR-007) or gate 2 (FR-013) requires an explicit confirmation. */
export class UnverifiedContentConfirmationRequiredError extends Error {
  constructor() {
    super(
      "This collection's requests and any embedded pre-request/test scripts have never been " +
        "confirmed. They were not generated or verified by ApiPilot and will execute exactly as " +
        "authored.",
    );
    this.name = "UnverifiedContentConfirmationRequiredError";
  }
}

/** Gate 2 (FR-013) — identical shape to `execution/start`'s existing `confirmation_required` error. */
export class ConfirmationRequiredError extends Error {
  constructor(public readonly requirement: ExecutionConfirmationRequirement) {
    super("This execution requires explicit confirmation before it can start.");
    this.name = "ConfirmationRequiredError";
  }
}

/** `execution/start` was called while a run of either kind is already in progress (FR-015). */
export class ExecutionInProgressError extends Error {
  constructor(public readonly runId: string) {
    super(`An execution run (${runId}) is already in progress for this session.`);
    this.name = "ExecutionInProgressError";
  }
}

/** `execution/cancel` was called with no uploaded-collection run currently in progress. */
export class NoRunInProgressError extends Error {
  constructor() {
    super("No uploaded-collection execution run is currently in progress.");
    this.name = "NoRunInProgressError";
  }
}

/** `GET .../execution/runs/:runId` named an id absent from this session's uploaded-collection run history. */
export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No uploaded-collection execution run with id '${runId}' was found.`);
    this.name = "RunNotFoundError";
  }
}
