import { describe, expect, it } from "vitest";
import { SUPPORTED_DYNAMIC_VARIABLES } from "@apipilot/shared-domain";
import {
  DYNAMIC_VARIABLE_CATEGORIES,
  POSTMAN_DYNAMIC_VARIABLE_SUGGESTIONS,
} from "../../src/components/postmanDynamicVariables";

describe("Postman dynamic variable catalog", () => {
  it("offers each variable once, with a description", () => {
    const names = POSTMAN_DYNAMIC_VARIABLE_SUGGESTIONS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(POSTMAN_DYNAMIC_VARIABLE_SUGGESTIONS.every((entry) => entry.detail.length > 0)).toBe(true);
    expect(DYNAMIC_VARIABLE_CATEGORIES.flatMap((category) => category.variables)).toHaveLength(names.length);
  });

  it("only offers variables the shared domain supports", () => {
    const unsupported = POSTMAN_DYNAMIC_VARIABLE_SUGGESTIONS.map((entry) => entry.name).filter(
      (name) => !SUPPORTED_DYNAMIC_VARIABLES.has(name),
    );
    expect(unsupported).toEqual([]);
  });
});
