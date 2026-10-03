import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HelpDialog } from "../../src/components/HelpDialog";
import { WORKFLOWS } from "../../src/components/workflowCatalog";

describe("HelpDialog (AP-038 US4, FR-021)", () => {
  it("lists the keyboard shortcuts, with the platform's palette shortcut", () => {
    render(<HelpDialog shortcutHint="⌘ K" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts and workflows" })).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Keyboard shortcuts" })).getAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "⌘ KOpen the command palette",
      "EscClose a dialog or the palette",
      "↑ ↓ and EnterMove and choose in the palette",
    ]);
  });

  it("describes each of the five workflows with its start-screen sentence", () => {
    render(<HelpDialog shortcutHint="Ctrl K" onClose={vi.fn()} />);
    for (const workflow of WORKFLOWS) {
      expect(screen.getByText(workflow.title)).toBeInTheDocument();
      expect(screen.getByText(workflow.description)).toBeInTheDocument();
    }
  });

  it("focuses Close on open and closes with Close or Escape", () => {
    const onClose = vi.fn();
    render(<HelpDialog shortcutHint="Ctrl K" onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
