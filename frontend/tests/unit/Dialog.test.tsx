import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "../../src/components/Dialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Dialog testId="test-dialog" onClose={() => setOpen(false)}>
          <button type="button" data-testid="first">
            First
          </button>
          <button type="button" data-testid="last">
            Last
          </button>
        </Dialog>
      )}
    </div>
  );
}

describe("Dialog", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog testId="test-dialog" onClose={onClose}>
        <button type="button">Only</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab focus within the panel, wrapping from the last focusable element to the first", () => {
    render(
      <Dialog testId="test-dialog" onClose={() => {}}>
        <button type="button" data-testid="first">
          First
        </button>
        <button type="button" data-testid="last">
          Last
        </button>
      </Dialog>,
    );
    screen.getByTestId("last").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("restores focus to whatever was focused before the dialog opened, once it closes", () => {
    render(<Harness />);
    const openButton = screen.getByRole("button", { name: "Open" });
    openButton.focus();
    fireEvent.click(openButton);
    expect(screen.getByTestId("first")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("test-dialog")).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });
});
