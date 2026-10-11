/** Raised when the session has no workflow with an analysed specification to compute coverage from. */
export class NoActiveWorkflowError extends Error {
  constructor() {
    super("There is no active specification. Upload a specification in the guided workflow first.");
    this.name = "NoActiveWorkflowError";
  }
}

/** Raised when a requested `runId` is not a run visible to the calling session. */
export class RunNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`Run "${runId}" was not found for this session.`);
    this.name = "RunNotFoundError";
  }
}

/** Raised when a query parameter holds a value outside its closed vocabulary. */
export class InvalidCoverageFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCoverageFilterError";
  }
}

/** Raised when the filter asks for a category that cannot be measured (security and authorization). */
export class CategoryUnavailableError extends Error {
  constructor(public readonly category: string, public readonly reason: string) {
    super(`The ${category} category is unavailable: ${reason}`);
    this.name = "CategoryUnavailableError";
  }
}
