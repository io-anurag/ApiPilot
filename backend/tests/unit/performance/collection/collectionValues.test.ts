import { describe, expect, it } from "vitest";
import { baseUrlVariableOf, withBaseUrl } from "../../../../src/performance/collection/collectionValues";

/** AP-036 research R11, R12 (tasks T026); used by AP-037's collection seeding (FR-024). */

describe("the base URL", () => {
  it("takes the leading variable most URLs start with, ties going to the first in code-unit order", () => {
    expect(baseUrlVariableOf(["{{host}}/a", "{{base}}/b", "{{host}}/c", "https://x"])).toBe("host");
    expect(baseUrlVariableOf(["{{b}}/a", "{{a}}/b"])).toBe("a");
    expect(baseUrlVariableOf(["https://x/a"])).toBeNull();
  });

  it("writes only the leading base-URL variable as {{baseUrl}}", () => {
    expect(withBaseUrl("{{host}}/a/{{host}}", "host")).toBe("{{baseUrl}}/a/{{host}}");
    expect(withBaseUrl("{{other}}/a", "host")).toBe("{{other}}/a");
    expect(withBaseUrl("https://x/a", null)).toBe("https://x/a");
  });
});
