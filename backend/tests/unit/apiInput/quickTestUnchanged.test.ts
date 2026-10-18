import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQuickTest } from "../../../src/performance/quick/createQuickTest";
import { UnsupportedVersionError } from "../../../src/openapi/errors";

/**
 * AP-032 keeps its OpenAPI-YAML-only path and upload control (specs/056 FR-054): the quick performance
 * test does not use the new input layer, so a HAR is still refused exactly as it was before.
 */
describe("AP-032 quick performance test is unchanged by the input layer", () => {
  it("still refuses a HAR capture as an unsupported document", async () => {
    const har = Buffer.from(JSON.stringify({ log: { version: "1.2", entries: [] } }));
    await expect(createQuickTest(har, "capture.har", true)).rejects.toBeInstanceOf(UnsupportedVersionError);
  });

  it("still accepts an OpenAPI YAML specification", async () => {
    const yamlText = readFileSync(path.resolve(__dirname, "../../fixtures/openapi/quick-performance.yaml"));
    const created = await createQuickTest(yamlText, "quick-performance.yaml", true);
    expect(created.specification.operationCount).toBeGreaterThan(0);
  });
});
