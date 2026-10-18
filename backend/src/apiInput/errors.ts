/**
 * Typed failures of the format-independent input layer (specs/056-har-json-input-support). Each one
 * maps to a distinct, actionable client message (FR-051). No message ever echoes content from the
 * uploaded document, a file name taken from inside it, a path or a stack trace.
 */

export const SUPPORTED_FORMATS_TEXT =
  "OpenAPI 3.x (YAML or JSON), HAR capture (JSON), ApiPilot API definition (JSON)";

/** Content starts with `{` or `[`, is neither valid JSON nor valid YAML. */
export class InvalidJsonError extends Error {
  constructor(detail: string) {
    super(`The uploaded file looks like JSON but could not be parsed: ${detail}`);
    this.name = "InvalidJsonError";
  }
}

/** A JSON document that carries none of the supported format markers, or is not an object. */
export class UnrecognizedInputError extends Error {
  constructor(supportedFormats: string = SUPPORTED_FORMATS_TEXT) {
    super(
      `The JSON file was not recognized. No OpenAPI, HAR, ApiPilot API definition or Postman collection marker was found. Supported inputs: ${supportedFormats}.`,
    );
    this.name = "UnrecognizedInputError";
  }
}

/** A JSON document that carries markers of two or more families; never resolved by precedence. */
export class AmbiguousInputError extends Error {
  readonly families: readonly string[];
  constructor(families: readonly string[]) {
    super(
      `The JSON file matches more than one supported format (${families.join(", ")}), so it was not imported. Remove the extra markers so the file is only one of: ${SUPPORTED_FORMATS_TEXT}.`,
    );
    this.name = "AmbiguousInputError";
    this.families = families;
  }
}

/** A Postman collection uploaded to the guided workflow: recognized, never imported here. */
export class PostmanCollectionDetectedError extends Error {
  readonly redirectTo = "import-run-collection";
  constructor() {
    super(
      "This file is a Postman collection, which the guided workflow does not use. Nothing was imported. Open Import & Run Collection to import and run it.",
    );
    this.name = "PostmanCollectionDetectedError";
  }
}

/** HAR marker present but the structure is unusable (FR-009). */
export class InvalidHarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHarError";
  }
}

/** Definition marker present but the document violates version 1; carries every violation (FR-024). */
export class InvalidDefinitionError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      `The API definition is not valid for version 1: ${problems.length} problem${problems.length === 1 ? "" : "s"} found. Nothing was imported.`,
    );
    this.name = "InvalidDefinitionError";
    this.problems = problems;
  }
}

/** A HAR from which no operation could be derived (FR-021). The report is safe to return. */
export class NoOperationsDerivedError<Report = unknown> extends Error {
  readonly report: Report;
  constructor(message: string, report: Report) {
    super(message);
    this.name = "NoOperationsDerivedError";
    this.report = report;
  }
}

/** A documented input limit was exceeded; names the limit and the remedy (FR-045). */
export class InputLimitExceededError extends Error {
  readonly limit: string;
  readonly maximum: number;
  constructor(limit: string, maximum: number, remedy: string) {
    super(`The file exceeds the limit ${limit} (${maximum}). ${remedy}`);
    this.name = "InputLimitExceededError";
    this.limit = limit;
    this.maximum = maximum;
  }
}

/** Raised when the input layer finds an invariant broken in its own output (a bug, never user input). */
export class InputLayerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputLayerInvariantError";
  }
}
