/** Thrown when uploaded file content cannot be parsed as YAML (FR-004). */
export class InvalidYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidYamlError";
  }
}

/** Thrown when a document is valid YAML but not a supported OpenAPI 3.x version (FR-004). */
export class UnsupportedVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedVersionError";
  }
}
