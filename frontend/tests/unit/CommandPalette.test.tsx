import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CommandPalette } from "../../src/components/CommandPalette";
import { buildCommands } from "../../src/components/paletteCommands";

function renderPalette(workflowShown = false) {
  const onRun = vi.fn();
  const onClose = vi.fn();
  const commands = buildCommands({ workflowShown, theme: "light" });
  render(<CommandPalette commands={commands} onRun={onRun} onClose={onClose} shortcutHint="Ctrl K" />);
  return { onRun, onClose, commands, input: screen.getByRole("combobox", { name: "Filter commands" }) };
}

const selected = () => screen.getByRole("option", { selected: true });

describe("CommandPalette (AP-038 US3)", () => {
  it("opens as a named modal dialog with focus in the filter and the first command active (FR-022)", () => {
    const { input } = renderPalette();
    expect(screen.getByRole("dialog", { name: "Command palette" })).toHaveAttribute("aria-modal", "true");
    expect(input).toHaveFocus();
    expect(selected()).toHaveTextContent("Guided Workflow");
    expect(input).toHaveAttribute("aria-activedescendant", selected().id);
  });

  it("narrows the list as the user types, and says so when nothing matches (FR-016)", () => {
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: "k6" } });
    const options = within(screen.getByRole("listbox", { name: "Commands" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Run k6 Script")]);

    fireEvent.change(input, { target: { value: "nothing like this" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching commands");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves the active option with the arrow keys, wrapping at both ends", () => {
    const { input } = renderPalette();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selected()).toHaveTextContent("Switch to dark theme");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toHaveTextContent("Guided Workflow");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toHaveTextContent("Import & Run Collection");
    expect(input).toHaveAttribute("aria-activedescendant", selected().id);
  });

  it("runs the active command on Enter, and a clicked command on click", () => {
    const { input, onRun, commands } = renderPalette(true);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).toHaveBeenLastCalledWith(commands[1]);

    fireEvent.click(screen.getByRole("option", { name: /Back to start/ }));
    expect(onRun).toHaveBeenLastCalledWith({ kind: "back-to-start", label: "Back to start" });
  });

  it("does nothing on Enter when no command matches", () => {
    const { input, onRun } = renderPalette();
    fireEvent.change(input, { target: { value: "zzz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).not.toHaveBeenCalled();
  });

  it("closes on Escape and on a click outside the panel (FR-017)", () => {
    const { input, onClose } = renderPalette();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = screen.getByTestId("command-palette").parentElement?.parentElement;
    fireEvent.click(backdrop as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("command-palette"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
