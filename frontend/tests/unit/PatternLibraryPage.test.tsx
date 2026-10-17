import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PatternLibraryPage } from "../../src/pages/PatternLibraryPage";

const SECTIONS = [
  "Stat tile",
  "Widget card",
  "Pill chips and status chips",
  "Method badges",
  "Task card",
  "Stepper",
  "Table with header tint and pager",
  "Banner",
  "Empty state",
  "Drop zone",
  "Key-value block",
  "Buttons and form fields",
  "Dialog",
];

describe("PatternLibraryPage (AP-054 FR-014)", () => {
  it("shows an example of every documented pattern, each in its own named region", () => {
    render(<PatternLibraryPage />);
    for (const title of SECTIONS) {
      expect(screen.getByRole("region", { name: title }), title).toBeInTheDocument();
    }
  });

  it("shows the stepper's done, current and locked states in words", () => {
    render(<PatternLibraryPage />);
    const stepper = screen.getByRole("region", { name: "Stepper" });
    expect(within(stepper).getByText("Finish a run first")).toBeInTheDocument();
    expect(within(stepper).getByText("Done")).toBeInTheDocument();
    expect(stepper.querySelector('[aria-current="step"]')).not.toBeNull();
  });

  it("has a table with semantic headers and a pager", () => {
    render(<PatternLibraryPage />);
    const section = screen.getByRole("region", { name: "Table with header tint and pager" });
    expect(within(section).getAllByRole("columnheader")).toHaveLength(3);
    expect(within(section).getByTestId("pattern-library-pagination")).toBeInTheDocument();
  });

  it("opens and closes the example dialog, returning focus to its button", () => {
    render(<PatternLibraryPage />);
    const open = screen.getByRole("button", { name: "Open example dialog" });
    open.focus();
    fireEvent.click(open);
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
});
