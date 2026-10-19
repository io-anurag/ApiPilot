import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import { specificationRevision } from "../../../src/apiCoverage/specRevision";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { generateCollection } from "../../../src/postman/generateCollection";
import { serializeArtifact } from "../../../src/postman/ordering";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import {
  applyReviewUpdates,
  createReviewWorkspace,
  projectApprovedTestModel,
} from "../../../src/testDesign/reviewTestModel";

/**
 * AP-057 T003 / FR-067 / SC-014: Security Lab adds optional fields to `ApiModel` and a new exporter
 * entry point. Everything the existing pipeline produces for an existing input must stay byte-identical:
 * deterministic generation, the approved model after review, the exported collection, and the
 * specification revision. The golden files were captured once from the unmodified repository, before
 * any AP-057 code changed, and are never regenerated to accept a changed output. Set
 * `UPDATE_SECURITY_GOLDEN=1` only to capture a missing file.
 *
 * The `ApiModel` itself is deliberately not compared: it gains additive optional fields by design.
 */

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/openapi");
const GOLDEN_DIR = path.resolve(__dirname, "../../fixtures/securityLab/golden");
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
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

async function loadFixtureModel(file: string): Promise<ApiModel | undefined> {
  try {
    const raw = parseYaml(readFileSync(path.join(FIXTURE_DIR, file), "utf-8"));
    const { document, issues } = await validateSpec(raw);
    return buildApiModel(document, issues);
  } catch {
    return undefined; // intentionally invalid fixtures (unsupported version, invalid YAML)
  }
}

function approvedAfterReview(testModel: TestModel): TestModel {
  const workspace = createReviewWorkspace(testModel);
  const { workspace: reviewed } = applyReviewUpdates(
    workspace,
    workspace.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      revision: scenario.revision,
      action: "accept" as const,
      actor: "baseline",
    })),
    () => FIXED_NOW,
  );
  return projectApprovedTestModel(reviewed);
}

function snapshotText(apiModel: ApiModel): string {
  const testModel = withStableIds(generateTestModel(apiModel));
  const approved = approvedAfterReview(testModel);
  const outcome = generateCollection(apiModel, approved, OPTIONS);
  const collectionText = outcome.ok
    ? [serializeArtifact(outcome.result.collection), serializeArtifact(outcome.result.environment)].join("\n----\n")
    : `FAILURE ${outcome.failure.code}`;
  return [
    `revision ${specificationRevision(apiModel)}`,
    `scenarios ${JSON.stringify(testModel)}`,
    `approved ${JSON.stringify(approved)}`,
    `export ${collectionText}`,
  ].join("\n====\n");
}

function checkGolden(name: string, actual: string): void {
  const goldenPath = path.join(GOLDEN_DIR, `${name}.golden.txt`);
  if (!existsSync(goldenPath)) {
    if (process.env.UPDATE_SECURITY_GOLDEN === "1") {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(goldenPath, actual);
      return;
    }
    throw new Error(`Missing golden file ${goldenPath}; capture it from the unmodified repository with UPDATE_SECURITY_GOLDEN=1`);
  }
  expect(actual).toBe(readFileSync(goldenPath, "utf-8"));
}

/**
 * `paypal-invoicing-v2.yaml` is left out on purpose: it generates thousands of scenarios, so reviewing and
 * exporting it takes minutes and its golden file would be about 24 MB. The exporter's own golden test
 * (`tests/unit/postman/existingArtifactsUnchanged.test.ts`) already covers it.
 */
const EXCLUDED_FIXTURES = new Set(["paypal-invoicing-v2.yaml"]);

describe("existing generation, review, export and revision outputs are unchanged (FR-067, SC-014)", () => {
  const fixtures = readdirSync(FIXTURE_DIR).filter((file) => file.endsWith(".yaml") && !EXCLUDED_FIXTURES.has(file));

  it("has fixtures to compare", () => {
    expect(fixtures.length).toBeGreaterThan(5);
  });

  for (const file of fixtures) {
    it(`${file}: revision, scenarios, approved model and export are byte-identical`, async () => {
      const apiModel = await loadFixtureModel(file);
      if (!apiModel) return;
      checkGolden(`openapi-${file.replace(/\.yaml$/, "")}`, snapshotText(apiModel));
    });
  }
});
