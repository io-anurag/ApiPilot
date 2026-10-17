import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "../../src/hooks/useFocusTrap";

function Harness({ onClose }: Readonly<{ onClose: () => void }>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(
    ref,
    () => {
      onClose();
      setOpen(false);
    },
    open,
  );
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {open && (
        <div ref={ref}>
          <button type="button">first</button>
          <button type="button">last</button>
        </div>
      )}
    </div>
  );
}

function openIt() {
  const opener = screen.getByRole("button", { name: "opener" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("useFocusTrap", () => {
  it("wraps Tab from the last control to the first and Shift+Tab back", () => {
    render(<Harness onClose={() => undefined} />);
    openIt();
    screen.getByRole("button", { name: "last" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "last" })).toHaveFocus();
  });

  it("calls onClose on Escape and returns focus to the opener", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = openIt();
    screen.getByRole("button", { name: "first" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it("does nothing while inactive", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
