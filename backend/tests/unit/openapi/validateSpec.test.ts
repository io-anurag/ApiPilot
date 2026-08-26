import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UnsupportedVersionError } from "../../../src/openapi/errors";
import { validateSpec } from "../../../src/openapi/validateSpec";

const fixturesDir = path.join(__dirname, "..", "..", "fixtures", "openapi");
const loadFixture = (name: string) => yaml.load(readFileSync(path.join(fixturesDir, name), "utf-8"));

describe("validateSpec", () => {
  it("rejects a Swagger 2.0 document with UnsupportedVersionError", async () => {
    const doc = loadFixture("unsupported-version.yaml");

    await expect(validateSpec(doc)).rejects.toBeInstanceOf(UnsupportedVersionError);
  });

  it("resolves internal $refs for a valid document without issues", async () => {
    const doc = loadFixture("valid.yaml");

    const { document, issues } = await validateSpec(doc);

    expect(issues).toEqual([]);
    const paths = document.paths as Record<string, unknown>;
    const getPets = (paths["/pets"] as Record<string, unknown>).get as Record<string, unknown>;
    const responses = getPets.responses as Record<string, unknown>;
    const ok = (responses["200"] as Record<string, unknown>).content as Record<string, unknown>;
    const schema = (ok["application/json"] as Record<string, unknown>).schema as Record<string, unknown>;
    // Dereferenced: items should now be the actual Pet schema, not a $ref pointer.
    expect((schema.items as Record<string, unknown>).$ref).toBeUndefined();
  });

  it("records an unresolved-ref issue for an internal ref pointing to a nonexistent schema", async () => {
    const doc = loadFixture("unresolved-ref.yaml");

    const { issues } = await validateSpec(doc);

    expect(issues.some((issue) => issue.kind === "unresolved-ref")).toBe(true);
  });

  it("records an unresolved-ref issue for an external ref and never fetches it", async () => {
    const doc = loadFixture("external-ref.yaml");

    const { issues } = await validateSpec(doc);

    expect(issues).toEqual([
      expect.objectContaining({ kind: "unresolved-ref", message: expect.stringContaining("shared-schemas.yaml") }),
    ]);
  });

  it("records a circular-ref issue for a self-referencing schema", async () => {
    const doc = loadFixture("circular-ref.yaml");

    const { issues } = await validateSpec(doc);

    expect(issues.some((issue) => issue.kind === "circular-ref")).toBe(true);
  });
});
