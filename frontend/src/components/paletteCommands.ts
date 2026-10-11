import type { Theme } from "../hooks/useTheme";
import { RESULTS_VIEWS, WORKFLOWS, type TopLevelView } from "./workflowCatalog";

/**
 * Pure helpers behind the command palette (AP-038 US3, research.md D7): which commands exist,
 * how they filter, and when the keyboard shortcut may open the palette. Kept free of React and
 * the DOM event loop so each rule is unit-testable on its own.
 */

export type Command =
  | { readonly kind: "workflow"; readonly id: TopLevelView; readonly label: string }
  | { readonly kind: "back-to-start"; readonly label: "Back to start" }
  | {
      readonly kind: "theme";
      readonly target: Theme;
      readonly label: "Switch to light theme" | "Switch to dark theme";
    };

/** The fixed command list for the current state (FR-015): the five workflows in tab order, then the results views (AP-046),
 * "Back to start" only while a workflow view is shown, and the opposite theme. */
export function buildCommands({
  workflowShown,
  theme,
}: Readonly<{ workflowShown: boolean; theme: Theme }>): Command[] {
  const commands: Command[] = WORKFLOWS.map((workflow) => ({
    kind: "workflow" as const,
    id: workflow.id,
    label: workflow.title,
  }));
  for (const view of RESULTS_VIEWS) commands.push({ kind: "workflow", id: view.id, label: view.title });
  if (workflowShown) commands.push({ kind: "back-to-start", label: "Back to start" });
  commands.push(
    theme === "light"
      ? { kind: "theme", target: "dark", label: "Switch to dark theme" }
      : { kind: "theme", target: "light", label: "Switch to light theme" },
  );
  return commands;
}

/** Case-insensitive substring match on the label, keeping the original order (FR-016). */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...commands];
  return commands.filter((command) => command.label.toLowerCase().includes(needle));
}

/** Ctrl+K, or Cmd+K on macOS, with no other modifier. */
export function isPaletteShortcut(
  event: Readonly<Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">>,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  );
}

/** True when a keystroke belongs to a text field or editable region, which must keep it (FR-018). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.getAttribute("contenteditable") === "true") return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function isMacPlatform(nav: Readonly<{ platform?: string; userAgent?: string }> | undefined): boolean {
  if (!nav) return false;
  return /mac|iphone|ipad|ipod/i.test(nav.platform || nav.userAgent || "");
}

/** The shortcut as shown to the user, e.g. in the header hint and the help dialog. */
export function shortcutLabel(isMac: boolean): string {
  return isMac ? "⌘ K" : "Ctrl K";
}
