import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("shows the affected-item count and confirms without a reason when none is required", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        message="Accept all filtered scenarios"
        affectedCount={42}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("confirm-dialog-count")).toHaveTextContent("42");

    fireEvent.click(screen.getByRole("button", { name: /^Confirm/ }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("disables Confirm until a reason is provided when one is required, then passes it through", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        message="Reject all filtered scenarios"
        affectedCount={7}
        requireReason
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const confirmButton = screen.getByRole("button", { name: /^Confirm/ });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Out of date scenarios" },
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledWith("Out of date scenarios");
  });

  it("cancels without confirming", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        message="Approve selected workflows"
        affectedCount={3}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders as an accessible alert dialog and focuses Cancel by default", () => {
    render(
      <ConfirmDialog
        message="Approve selected workflows"
        affectedCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("keeps keyboard focus inside the dialog", () => {
    render(
      <ConfirmDialog
        message="Reject selected workflows"
        affectedCount={3}
        requireReason
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const reason = screen.getByLabelText("Reason");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    reason.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(reason);
  });

  it("restores focus to the control that opened it", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open confirmation
          </button>
          {open && (
            <ConfirmDialog
              message="Approve selected workflows"
              affectedCount={3}
              onConfirm={vi.fn()}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(trigger);
  });
});
