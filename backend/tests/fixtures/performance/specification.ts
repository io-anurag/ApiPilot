import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ApiModel } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { validateSpec } from "../../../src/openapi/validateSpec";

/** The AP-029 fixture specification (`tests/fixtures/openapi/performance.yaml`, tasks T002). */
export const PERFORMANCE_SPECIFICATION_FILENAME = "performance.yaml";

const fixturePath = path.join(__dirname, "..", "openapi", PERFORMANCE_SPECIFICATION_FILENAME);

export function performanceSpecificationBuffer(): Buffer {
  return readFileSync(fixturePath);
}

export async function loadPerformanceApiModel(): Promise<ApiModel> {
  const { document, issues } = await validateSpec(yaml.load(readFileSync(fixturePath, "utf-8")));
  return buildApiModel(document, issues);
}
