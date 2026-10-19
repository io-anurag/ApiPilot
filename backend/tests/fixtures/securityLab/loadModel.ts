import { readFileSync } from "node:fs";
import path from "node:path";
import type { ApiModel } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";

const DIR = path.resolve(__dirname);

/** Loads one of the Security Lab fixture specifications into an `ApiModel` through the real OpenAPI pipeline. */
export async function loadSecurityFixtureModel(file: string): Promise<ApiModel> {
  const raw = parseYaml(readFileSync(path.join(DIR, file), "utf-8"));
  const { document, issues } = await validateSpec(raw);
  return buildApiModel(document, issues);
}

const OK = { "200": { description: "ok" } };

/** Builds a model from a small inline OpenAPI document, for cases a fixture file does not cover. */
export function modelFromDocument(document: Record<string, unknown>): ApiModel {
  return buildApiModel({ openapi: "3.0.3", info: { title: "inline", version: "1" }, paths: {}, ...document }, []);
}

export { OK as OK_RESPONSES };

/** The same model as if it came from captured traffic: no recorded security source, every operation observed. */
export function asObservedModel(model: ApiModel): ApiModel {
  return {
    ...model,
    operations: model.operations.map((operation) => {
      const { securitySource: _omitted, ...rest } = operation;
      void _omitted;
      return { ...rest, security: [], provenance: { origin: "observed" as const, observationCount: 3, confidence: "high" as const } };
    }),
  };
}
