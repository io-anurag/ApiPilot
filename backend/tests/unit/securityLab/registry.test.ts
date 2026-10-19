import { describe, expect, it } from "vitest";
import { GENERATABLE_CATEGORY_IDS, SECURITY_CATEGORY_IDS, TAXONOMY_EDITION, TAXONOMY_IDS } from "@apipilot/shared-domain";
import {
  executableCategoryIds,
  getCategory,
  isGeneratableCategoryId,
  listCategories,
  taxonomyFor,
} from "../../../src/securityLab/registry/categories";
import { OWASP_API_TOP10_2023, taxonomyName } from "../../../src/securityLab/registry/taxonomy";

describe("category registry", () => {
  it("has exactly the eleven categories of the brief, once each", () => {
    expect(listCategories().map((c) => c.id)).toEqual([...SECURITY_CATEGORY_IDS]);
    expect(new Set(listCategories().map((c) => c.id)).size).toBe(11);
  });

  it("maps every category to at least one identifier of the 2023 edition", () => {
    for (const category of listCategories()) {
      expect(category.taxonomy.length, category.id).toBeGreaterThan(0);
      for (const entry of category.taxonomy) {
        expect(entry.edition).toBe(TAXONOMY_EDITION);
        expect(TAXONOMY_IDS).toContain(entry.id);
      }
    }
  });

  it("records input validation as related to API8, never primary (OWASP 2023 has no input-validation entry)", () => {
    const category = getCategory("input-validation");
    expect(category.taxonomy).toEqual([{ edition: TAXONOMY_EDITION, id: "API8", relation: "related" }]);
    expect(category.limitationNote).toMatch(/judgement/);
  });

  it("keeps support level separate from taxonomy membership", () => {
    const inventory = getCategory("api-inventory");
    expect(inventory.supportLevel).toBe("analysis-only");
    expect(inventory.taxonomy[0]?.relation).toBe("primary");
    const business = getCategory("sensitive-business-flows");
    expect(business.supportLevel).toBe("limited");
    expect(business.taxonomy[0]?.relation).toBe("primary");
  });

  it("documents SSRF and inventory as non-generatable and non-executable, with the reason", () => {
    for (const id of ["ssrf-unsafe-consumption", "api-inventory"] as const) {
      const category = getCategory(id);
      expect(category.generatable).toBe(false);
      expect(category.executable).toBe(false);
      expect(isGeneratableCategoryId(id)).toBe(false);
      expect(category.limitationNote?.length).toBeGreaterThan(10);
    }
    expect(getCategory("ssrf-unsafe-consumption").supportLevel).toBe("limited");
  });

  it("agrees with the shared-domain list of generatable categories", () => {
    expect(listCategories().filter((c) => c.generatable).map((c) => c.id)).toEqual([...GENERATABLE_CATEGORY_IDS]);
    for (const id of executableCategoryIds()) expect(isGeneratableCategoryId(id)).toBe(true);
  });

  it("copies the taxonomy onto a scenario so later registry changes cannot alter it", () => {
    const copy = taxonomyFor("authentication");
    expect(copy).toEqual(getCategory("authentication").taxonomy);
    expect(copy[0]).not.toBe(getCategory("authentication").taxonomy[0]);
  });

  it("names the ten 2023 entries as the official edition does", () => {
    expect(OWASP_API_TOP10_2023.map((e) => e.id)).toEqual([...TAXONOMY_IDS]);
    expect(taxonomyName(TAXONOMY_EDITION, "API1")).toBe("Broken Object Level Authorization");
    expect(taxonomyName(TAXONOMY_EDITION, "API7")).toBe("Server Side Request Forgery");
    expect(taxonomyName(TAXONOMY_EDITION, "API10")).toBe("Unsafe Consumption of APIs");
  });
});
