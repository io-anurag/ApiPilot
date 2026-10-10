import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tabs } from "../../src/components/Tabs";

const TABS = [
  { id: "one", label: "One" },
  { id: "two", label: "Two" },
] as const;

describe("Tabs", () => {
  it("marks only the active tab with aria-current", () => {
    render(<Tabs tabs={TABS} activeTab="one" onChange={() => {}} label="Test tabs" />);
    expect(screen.getByRole("button", { name: "One" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Two" })).not.toHaveAttribute("aria-current");
  });

  it("is a native, keyboard-reachable button per tab, and reports the clicked tab's id", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeTab="one" onChange={onChange} label="Test tabs" />);
    const secondTab = screen.getByRole("button", { name: "Two" });
    expect(secondTab.tagName).toBe("BUTTON");
    secondTab.focus();
    expect(secondTab).toHaveFocus();
    fireEvent.click(secondTab);
    expect(onChange).toHaveBeenCalledWith("two");
  });

  it("keeps the active tab off the section accent when the tabs switch workflows (AP-041)", () => {
    const { rerender } = render(
      <Tabs tabs={TABS} activeTab="one" onChange={() => {}} label="Test tabs" />,
    );
    expect(screen.getByRole("button", { name: "One" }).className).toContain("text-brand-700");

    rerender(<Tabs tabs={TABS} activeTab="one" onChange={() => {}} label="Test tabs" accent="neutral" />);
    const active = screen.getByRole("button", { name: "One" });
    expect(active.className).toContain("border-text-primary");
    expect(active.className).not.toContain("text-brand-700");
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("labels the tab list for assistive technology", () => {
    render(<Tabs tabs={TABS} activeTab="one" onChange={() => {}} label="Test tabs" />);
    expect(screen.getByRole("navigation", { name: "Test tabs" })).toBeInTheDocument();
  });

  it("draws an optional colour marker without changing the tab's name or current state (AP-038 FR-013)", () => {
    const { container } = render(
      <Tabs
        tabs={[
          { id: "one", label: "One", markerClassName: "bg-wf-guided" },
          { id: "two", label: "Two" },
        ]}
        activeTab="one"
        onChange={() => {}}
        label="Test tabs"
      />,
    );
    const marker = container.querySelector(".bg-wf-guided");
    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "One" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Two" })).toBeInTheDocument();
  });
});
