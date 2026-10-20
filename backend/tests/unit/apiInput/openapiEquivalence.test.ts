import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import type { TestModel } from "@apipilot/shared-domain";
import { loadApiInput } from "../../../src/apiInput";
import { UnsupportedVersionError } from "../../../src/openapi/errors";
import { InvalidYamlError } from "../../../src/openapi/errors";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/openapi");

function normalized(model: TestModel): unknown {
  return model.scenarios.map((scenario, index) => ({ ...scenario, id: `s${index}` }));
}

describe("OpenAPI YAML and JSON twins are equivalent (SC-001, FR-008)", () => {
  const fixtures = readdirSync(FIXTURE_DIR).filter((file) => file.endsWith(".yaml") && file !== "unsupported-version.yaml");

  it("has fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(5);
  });

  for (const file of fixtures) {
    it(`${file}: same normalized model and same deterministic scenarios`, async () => {
      const yamlText = readFileSync(path.join(FIXTURE_DIR, file), "utf-8");
      const fromYaml = await loadApiInput(Buffer.from(yamlText), file);
      const jsonText = JSON.stringify(yaml.load(yamlText));
      const fromJson = await loadApiInput(Buffer.from(jsonText), file.replace(/\.yaml$/, ".json"));

      expect(fromYaml.input.format).toBe("openapi-yaml");
      expect(fromJson.input.format).toBe("openapi-json");
      expect(fromJson.apiModel).toEqual(fromYaml.apiModel);
      expect(normalized(generateTestModel(fromJson.apiModel))).toEqual(normalized(generateTestModel(fromYaml.apiModel)));
      // The large paypal fixture alone takes ~2 s (it is loaded and generated twice); the default 5 s
      // limit is exceeded when the full suite runs many workers in parallel.
    }, 30_000);
  }

  it("gives a Swagger 2.0 document as JSON the identical unsupported-version outcome as YAML", async () => {
    const yamlText = readFileSync(path.join(FIXTURE_DIR, "unsupported-version.yaml"), "utf-8");
    const jsonText = JSON.stringify(yaml.load(yamlText));
    const outcome = async (text: string) => {
      try {
        await loadApiInput(Buffer.from(text), "x");
        return "no error";
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedVersionError);
        return (error as Error).message;
      }
    };
    expect(await outcome(jsonText)).toBe(await outcome(yamlText));
  });

  it("keeps the unchanged invalid-YAML outcome for non-JSON text", async () => {
    const text = readFileSync(path.join(FIXTURE_DIR, "invalid-yaml.txt"), "utf-8");
    await expect(loadApiInput(Buffer.from(text), "invalid.yaml")).rejects.toBeInstanceOf(InvalidYamlError);
  });

  it("keeps the unchanged empty-document outcome", async () => {
    for (const empty of ["", "   \n", "﻿"]) {
      await expect(loadApiInput(Buffer.from(empty), "empty.yaml")).rejects.toThrow(
        "The uploaded file could not be parsed as YAML: document is empty or not an object",
      );
    }
  });
});
