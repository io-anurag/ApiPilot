import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../../src/components/EmptyState";

describe("EmptyState", () => {
  it("renders the message and an optional description", () => {
    render(<EmptyState message="No results" description="Try a different filter." />);
    const state = screen.getByTestId("empty-state");
    expect(state).toHaveTextContent("No results");
    expect(state).toHaveTextContent("Try a different filter.");
  });

  it("renders without the boxed icon treatment when compact", () => {
    render(<EmptyState compact message="No matches" />);
    expect(screen.getByTestId("empty-state").tagName).toBe("P");
  });

  it("preserves a call site's own data-testid", () => {
    render(<EmptyState testId="custom-empty" message="Nothing here" />);
    expect(screen.getByTestId("custom-empty")).toHaveTextContent("Nothing here");
  });
});
