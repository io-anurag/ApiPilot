import { describe, expect, it } from "vitest";
import {
  buildCommands,
  filterCommands,
  isEditableTarget,
  isMacPlatform,
  isPaletteShortcut,
  shortcutLabel,
} from "../../src/components/paletteCommands";

const key = (overrides: Partial<Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">>) => ({
  key: "k",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("buildCommands (AP-038 FR-015)", () => {
  it("lists the five workflows in tab order, the Coverage results view (AP-046) and the opposite theme, with no Back to start on the start screen", () => {
    expect(buildCommands({ workflowShown: false, theme: "light" }).map((c) => c.label)).toEqual([
      "Guided Workflow",
      "Import & Run Collection",
      "Quick performance test",
      "Performance plans",
      "Run k6 Script",
      "API Test Coverage",
      "Switch to dark theme",
    ]);
  });

  it("offers Back to start while a workflow view is shown, and the light theme from dark", () => {
    const labels = buildCommands({ workflowShown: true, theme: "dark" }).map((c) => c.label);
    expect(labels.slice(-2)).toEqual(["Back to start", "Switch to light theme"]);
  });
});

describe("filterCommands (FR-016)", () => {
  const commands = buildCommands({ workflowShown: true, theme: "light" });

  it("keeps every command, in order, for an empty or blank query", () => {
    expect(filterCommands(commands, "   ")).toEqual(commands);
  });

  it("matches a substring of the label regardless of case, keeping order", () => {
    expect(filterCommands(commands, "RUN").map((c) => c.label)).toEqual([
      "Import & Run Collection",
      "Run k6 Script",
    ]);
    expect(filterCommands(commands, "theme").map((c) => c.label)).toEqual(["Switch to dark theme"]);
  });

  it("returns nothing when no label matches", () => {
    expect(filterCommands(commands, "xyz")).toEqual([]);
  });
});

describe("isPaletteShortcut", () => {
  it("accepts Ctrl+K and Cmd+K in either key case", () => {
    expect(isPaletteShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ metaKey: true, key: "K" }))).toBe(true);
  });

  it("rejects K alone and Ctrl+K with Alt or Shift", () => {
    expect(isPaletteShortcut(key({}))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, key: "j" }))).toBe(false);
  });
});

describe("isEditableTarget (FR-018)", () => {
  it("treats inputs, text areas, selects and editable regions as editable", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const region = document.createElement("div");
    region.setAttribute("contenteditable", "true");
    expect(isEditableTarget(region)).toBe(true);
  });

  it("treats buttons, the document body and no target as not editable", () => {
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("platform shortcut label", () => {
  it("shows ⌘ K on macOS and Ctrl K elsewhere", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
    expect(shortcutLabel(true)).toBe("⌘ K");
    expect(shortcutLabel(false)).toBe("Ctrl K");
  });
});
