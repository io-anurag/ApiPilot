import type { UploadedRequestResult } from "@apipilot/shared-domain";

/** `:resultIndex` is not a non-negative integer (contracts/failure-analysis-api.md row 1). */
export class InvalidResultIndexError extends Error {
  constructor(value: string) {
    super(`'${value}' is not a valid result position; use a non-negative whole number.`);
    this.name = "InvalidResultIndexError";
  }
}

/** The run has no result at `:resultIndex` (row 3). */
export class ResultNotFoundError extends Error {
  constructor(resultIndex: number) {
    super(`This run has no result at position ${resultIndex}.`);
    this.name = "ResultNotFoundError";
  }
}

/** Only failed results can be analyzed (FR-002, row 4). */
export class ResultNotFailedError extends Error {
  constructor(public readonly outcome: Exclude<UploadedRequestResult["outcome"], "failed">) {
    super(
      outcome === "passed"
        ? "This request passed, so there is no failure to analyze."
        : "This request was never sent, so there is no failure to analyze.",
    );
    this.name = "ResultNotFailedError";
  }
}

/** One analysis at a time per session (FR-016, row 5). */
export class FailureAnalysisInProgressError extends Error {
  constructor(
    public readonly runId: string,
    public readonly resultIndex: number,
  ) {
    super("Another failure analysis is already in progress in this session.");
    this.name = "FailureAnalysisInProgressError";
  }
}
