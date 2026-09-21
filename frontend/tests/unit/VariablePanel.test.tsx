import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VariableBinding } from "@apipilot/shared-domain";
import { VariablePanel } from "../../src/components/VariablePanel";

function variable(overrides: Partial<VariableBinding> = {}): VariableBinding {
  return { name: "baseUrl", value: "https://api.example.com", source: "environment", resolved: true, referenced: true, ...overrides };
}

describe("VariablePanel", () => {
  it("renders each variable with its resolved value and source label", () => {
    render(<VariablePanel variables={[variable()]} locked={false} onSave={vi.fn()} />);
    expect(screen.getByLabelText("Value for baseUrl")).toHaveValue("https://api.example.com");
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("shows a collection-default source label and missing styling for an unresolved variable", () => {
    render(
      <VariablePanel
        variables={[variable({ name: "token", value: undefined, source: "collection-default", resolved: false })]}
        locked={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Collection default")).toBeInTheDocument();
    expect(screen.getByLabelText("Value for token")).toHaveValue("");
  });

  it("editing and saving a value calls onSave with the new value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<VariablePanel variables={[variable({ value: "old" })]} locked={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Value for baseUrl"), { target: { value: "new-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
    await screen.findByRole("button", { name: "Save variables" });
    expect(onSave).toHaveBeenCalledWith({ baseUrl: "new-value" });
  });

  it("marks a value changed in this session once edited, and the marker is absent before editing", () => {
    render(<VariablePanel variables={[variable({ value: "old" })]} locked={false} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("Changed in this session")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Value for baseUrl"), { target: { value: "new-value" } });
    expect(screen.getByLabelText("Changed in this session")).toBeInTheDocument();
  });

  it("disables every control while locked", () => {
    render(<VariablePanel variables={[variable()]} locked onSave={vi.fn()} />);
    expect(screen.getByLabelText("Value for baseUrl")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save variables" })).toBeDisabled();
  });
});
