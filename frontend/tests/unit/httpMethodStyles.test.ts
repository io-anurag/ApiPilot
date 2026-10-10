import { describe, expect, it } from "vitest";
import {
  DEFAULT_METHOD_BADGE_CLASSES,
  METHOD_BADGE_CLASSES,
  METHOD_FILL_CLASSES,
} from "../../src/components/httpMethodStyles";
import { groupOperationsByMethod } from "../../src/utils/operationMethodGroups";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const fillOf = (badgeClasses: string) => badgeClasses.split(" ").find((cls) => cls.startsWith("bg-"));

describe("HTTP method colours", () => {
  it("gives every method, including HEAD and OPTIONS, its own colour", () => {
    const fills = METHODS.map((method) => fillOf(METHOD_BADGE_CLASSES[method]));
    expect(fills.every(Boolean)).toBe(true);
    expect(new Set(fills).size).toBe(METHODS.length);
  });

  it("uses one set of token classes for both themes, with no dark: overrides", () => {
    for (const classes of [...Object.values(METHOD_BADGE_CLASSES), ...Object.values(METHOD_FILL_CLASSES)]) {
      expect(classes).not.toContain("dark:");
    }
  });

  it("sets a label colour on every solid fill: dark on the bright ones, white on the rest", () => {
    for (const method of METHODS) {
      const label = METHOD_BADGE_CLASSES[method].split(" ").find((cls) => cls.startsWith("text-"));
      expect(["text-white", "text-code-surface"]).toContain(label);
    }
    for (const bright of ["PUT", "HEAD", "OPTIONS"]) {
      expect(METHOD_BADGE_CLASSES[bright]).toContain("text-code-surface");
    }
  });

  it("keeps the badge and the breakdown fill on the same colour for every method", () => {
    for (const method of METHODS) {
      expect(fillOf(METHOD_BADGE_CLASSES[method])).toBe(METHOD_FILL_CLASSES[method]);
    }
  });

  it("colours the API-review breakdown with the same fills, and leaves unlisted methods neutral", () => {
    const segments = groupOperationsByMethod(
      [...METHODS, "TRACE"].map((method) => ({ method }) as never),
    );
    for (const segment of segments.filter((entry) => entry.label !== "TRACE")) {
      expect(segment.fillClass).toBe(METHOD_FILL_CLASSES[segment.label]);
    }
    expect(segments.find((segment) => segment.label === "TRACE")).toMatchObject({
      tone: "neutral",
      fillClass: undefined,
    });
    expect(DEFAULT_METHOD_BADGE_CLASSES).toContain("bg-surface-strong");
  });
});
