import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { generateCollection } from "../../../src/postman/generateCollection";
import { serializeArtifact } from "../../../src/postman/ordering";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";

/**
 * AP-056 T002a / SC-002: every artifact the exporter produces for an input that has no form body and
 * no redaction placeholder must stay byte-identical. The golden files were captured once from the
 * unmodified exporter (before any AP-056 code changed) and are never regenerated, with one reviewed exception: the
 * `unsupported-content-type` label in `shared-export-fixture.golden.txt` was reworded by hand, at the user's request, to name the
 * supported set (2026-10-18). Set `UPDATE_POSTMAN_GOLDEN=1` only to capture a missing file, never to accept a changed output.
 */

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/openapi");
const GOLDEN_DIR = path.resolve(__dirname, "../../fixtures/postman/golden");
const OPTIONS = { baseUrl: "https://qa.internal.example", variableValues: { token: "t-1" } };

/** Replaces the random scenario ids with ones derived from position, so output is comparable across runs. */
function withStableIds(testModel: TestModel): TestModel {
  return {
    scenarios: testModel.scenarios.map((scenario, index) => ({
      ...scenario,
      id: `scenario-${String(index + 1).padStart(5, "0")}`,
    })),
  };
}

function exportText(apiModel: ApiModel, testModel: TestModel): string {
  const outcome = generateCollection(apiModel, testModel, OPTIONS);
  if (!outcome.ok) return `FAILURE ${outcome.failure.code}\n`;
  const { collection, environment, readme, limitations } = outcome.result;
  return [
    serializeArtifact(collection),
    serializeArtifact(environment),
    JSON.stringify(readme),
    JSON.stringify(limitations),
  ].join("\n----\n");
}

async function loadFixtureModel(file: string): Promise<ApiModel | undefined> {
  try {
    const raw = parseYaml(readFileSync(path.join(FIXTURE_DIR, file), "utf-8"));
    const { document, issues } = await validateSpec(raw);
    return buildApiModel(document, issues);
  } catch {
    return undefined; // intentionally invalid fixtures (unsupported version, invalid YAML)
  }
}

function checkGolden(name: string, actual: string): void {
  const goldenPath = path.join(GOLDEN_DIR, `${name}.golden.txt`);
  if (!existsSync(goldenPath)) {
    if (process.env.UPDATE_POSTMAN_GOLDEN === "1") {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(goldenPath, actual);
      return;
    }
    throw new Error(`Missing golden file ${goldenPath}; capture it from the unmodified exporter with UPDATE_POSTMAN_GOLDEN=1`);
  }
  expect(actual).toBe(readFileSync(goldenPath, "utf-8"));
}

describe("existing exporter artifacts are unchanged (SC-002)", () => {
  const fixtures = readdirSync(FIXTURE_DIR).filter((file) => file.endsWith(".yaml"));

  it("has fixtures to compare", () => {
    expect(fixtures.length).toBeGreaterThan(5);
  });

  for (const file of fixtures) {
    it(`${file}: collection, environment and README are byte-identical`, async () => {
      const apiModel = await loadFixtureModel(file);
      if (!apiModel) return;
      const testModel = withStableIds(generateTestModel(apiModel));
      checkGolden(`openapi-${file.replace(/\.yaml$/, "")}`, exportText(apiModel, testModel));
    });
  }

  it("shared export fixture is byte-identical", () => {
    checkGolden("shared-export-fixture", exportText(exportApiModel, approvedTestModel));
  });
});
