import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourcePicker } from "../../src/components/performance/path/SourcePicker";

describe("SourcePicker (FR-002, FR-006, FR-014)", () => {
  it("offers the four sources, each named and described", () => {
    render(<SourcePicker onPick={() => undefined} />);
    for (const name of ["OpenAPI specification", "Guided workflow", "Postman collection", "Empty plan"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeEnabled();
    }
    expect(screen.getByText("Write every step yourself, as in Postman.")).toBeInTheDocument();
  });

  it("reports the picked source, and has no pressed state before one is chosen", () => {
    const onPick = vi.fn();
    render(<SourcePicker onPick={onPick} />);
    const button = screen.getByRole("button", { name: /Postman collection/ });
    expect(button).not.toHaveAttribute("aria-pressed");
    fireEvent.click(button);
    expect(onPick).toHaveBeenCalledWith("collection");
  });

  it("shows the current source as pressed and, once locked, disables every other source", () => {
    render(<SourcePicker selected="specification" locked onPick={() => undefined} />);
    expect(screen.getByRole("button", { name: /OpenAPI specification/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /OpenAPI specification/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Guided workflow/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Empty plan/ })).toBeDisabled();
  });

  it("states what each source needs, so the engineer knows before choosing (050 FR-001)", () => {
    render(<SourcePicker onPick={() => undefined} />);
    expect(screen.getByRole("button", { name: /OpenAPI specification/ })).toHaveAccessibleName(/Needs a YAML file/);
    expect(screen.getByRole("button", { name: /Guided workflow/ })).toHaveAccessibleName(/Needs approved workflows/);
    expect(screen.getByRole("button", { name: /Postman collection/ })).toHaveAccessibleName(/Needs a collection/);
    expect(screen.getByRole("button", { name: /Empty plan/ })).toHaveAccessibleName(/Needs nothing/);
  });

  it("marks only the chosen card as pressed, so the choice is not carried by colour alone (050 FR-002)", () => {
    render(<SourcePicker selected="collection" onPick={() => undefined} />);
    expect(screen.getByRole("button", { name: /Postman collection/ })).toHaveAttribute("aria-pressed", "true");
    for (const name of [/OpenAPI specification/, /Guided workflow/, /Empty plan/]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });
});
