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

/** The AP-032 quick performance fixture (`tests/fixtures/openapi/quick-performance.yaml`, specs/032 tasks T001). */
export const QUICK_SPECIFICATION_FILENAME = "quick-performance.yaml";

const quickFixturePath = path.join(__dirname, "..", "openapi", QUICK_SPECIFICATION_FILENAME);

export function quickSpecificationBuffer(): Buffer {
  return readFileSync(quickFixturePath);
}

export async function loadQuickApiModel(): Promise<ApiModel> {
  const { document, issues } = await validateSpec(yaml.load(readFileSync(quickFixturePath, "utf-8")));
  return buildApiModel(document, issues);
}

/** A fixture file under `tests/fixtures/openapi/`, for upload-error tests. */
export function openApiFixtureBuffer(filename: string): Buffer {
  return readFileSync(path.join(__dirname, "..", "openapi", filename));
}

/** The AP-033 body-edit fixture (`tests/fixtures/openapi/body-edits.yaml`, specs/033 tasks T001). */
export const BODY_EDITS_SPECIFICATION_FILENAME = "body-edits.yaml";

const bodyEditsFixturePath = path.join(__dirname, "..", "openapi", BODY_EDITS_SPECIFICATION_FILENAME);

export function bodyEditsSpecificationBuffer(): Buffer {
  return readFileSync(bodyEditsFixturePath);
}

export async function loadBodyEditsApiModel(): Promise<ApiModel> {
  const { document, issues } = await validateSpec(yaml.load(readFileSync(bodyEditsFixturePath, "utf-8")));
  return buildApiModel(document, issues);
}
