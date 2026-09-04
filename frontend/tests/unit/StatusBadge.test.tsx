import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../../src/components/StatusBadge";

describe("StatusBadge", () => {
  it("renders the given label as text, not only as a color", () => {
    render(<StatusBadge label="Complete" tone="success" />);
    const badge = screen.getByTestId("status-badge");
    expect(badge).toHaveTextContent("Complete");
    expect(badge).toHaveAttribute("data-tone", "success");
  });

  it.each([
    ["Not yet reached", "neutral"],
    ["Active", "info"],
    ["Complete", "success"],
    ["Needs to be redone", "warning"],
    ["Skipped", "neutral"],
  ] as const)("renders %s with tone %s", (label, tone) => {
    render(<StatusBadge label={label} tone={tone} />);
    const badge = screen.getByTestId("status-badge");
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute("data-tone", tone);
  });

  it("defaults to a neutral tone when none is given", () => {
    render(<StatusBadge label="Pending" />);
    expect(screen.getByTestId("status-badge")).toHaveAttribute("data-tone", "neutral");
  });
});
