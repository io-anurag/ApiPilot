import { readFileSync } from "node:fs";
import path from "node:path";

const openApiFixturesDir = path.join(__dirname, "..", "openapi");

/** The multipart-upload buffer AP-002's own tests use; three operations, no analysis issues. */
export function validSpecificationBuffer(): Buffer {
  return readFileSync(path.join(openApiFixturesDir, "valid.yaml"));
}

export const VALID_SPECIFICATION_FILENAME = "valid.yaml";

/** Every operation in valid.yaml produces at least one positive scenario, so it is safe to use
 * both for the "at least one approved scenario" and (once every scenario is rejected) the
 * "zero approved scenarios" finalize edge case. */
export const VALID_SPECIFICATION_OPERATION_COUNT = 3;
