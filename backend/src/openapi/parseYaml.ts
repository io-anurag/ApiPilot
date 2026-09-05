import yaml from "js-yaml";
import { InvalidYamlError } from "./errors";
import { createLogger } from "../logger";

const logger = createLogger("openapi.parseYaml");

/** Parses YAML text into a plain JS object (FR-002). Throws InvalidYamlError on failure. */
export function parseYaml(content: string): unknown {
  logger.info("parse_start");
  try {
    const doc = yaml.load(content);
    if (doc === null || typeof doc !== "object") {
      throw new InvalidYamlError(
        "The uploaded file could not be parsed as YAML: document is empty or not an object",
      );
    }
    logger.info("parse_success");
    return doc;
  } catch (err) {
    if (err instanceof InvalidYamlError) {
      logger.error("parse_error", { errorCategory: "invalid_yaml" });
      throw err;
    }
    const details = err instanceof Error ? err.message : String(err);
    logger.error("parse_error", { errorCategory: "invalid_yaml" });
    throw new InvalidYamlError(`The uploaded file could not be parsed as YAML: ${details}`);
  }
}
