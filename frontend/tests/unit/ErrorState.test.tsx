import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorState } from "../../src/components/ErrorState";

describe("ErrorState", () => {
  it("renders the message as an alert", () => {
    render(<ErrorState message="Something failed" />);
    const state = screen.getByRole("alert");
    expect(state).toHaveTextContent("Something failed");
  });

  it("renders an optional detail line", () => {
    render(<ErrorState message="Export failed" detail="Try again." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Try again.");
  });

  it("renders additional children below the message/detail", () => {
    render(
      <ErrorState message="Validation failed">
        <ul>
          <li>Problem one</li>
        </ul>
      </ErrorState>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Problem one");
  });

  it("preserves a call site's own data-testid", () => {
    render(<ErrorState testId="custom-error" message="Failed" />);
    expect(screen.getByTestId("custom-error")).toHaveAttribute("role", "alert");
  });
});
