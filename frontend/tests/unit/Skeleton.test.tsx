import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "../../src/components/Skeleton";

describe("Skeleton", () => {
  it("renders a hidden placeholder", () => {
    render(<Skeleton />);
    expect(screen.getByTestId("skeleton")).toHaveAttribute("aria-hidden", "true");
  });

  it("accepts a custom size/shape via className", () => {
    render(<Skeleton className="h-2 w-2 rounded-full bg-brand-500" />);
    expect(screen.getByTestId("skeleton")).toHaveClass("h-2", "w-2", "rounded-full");
  });

  it("uses Tailwind's animate-pulse, whose duration index.css neutralizes under prefers-reduced-motion (FR-015)", () => {
    render(<Skeleton />);
    expect(screen.getByTestId("skeleton")).toHaveClass("animate-pulse");
  });
});
