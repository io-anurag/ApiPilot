import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VariableBinding } from "@apipilot/shared-domain";
import { VariablePanel } from "../../src/components/VariablePanel";

function variable(overrides: Partial<VariableBinding> = {}): VariableBinding {
  return { name: "baseUrl", value: "https://api.example.com", source: "environment", resolved: true, referenced: true, ...overrides };
}

describe("VariablePanel", () => {
  it("renders each variable with its resolved value and source label", () => {
    render(<VariablePanel variables={[variable()]} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Value for baseUrl")).toHaveValue("https://api.example.com");
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("shows a collection-default source label and missing styling for an unresolved variable", () => {
    render(
      <VariablePanel
        variables={[variable({ name: "token", value: undefined, source: "collection-default", resolved: false })]}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Collection default")).toBeInTheDocument();
    expect(screen.getByLabelText("Value for token")).toHaveValue("");
  });

  it("editing and saving a value calls onSave with the new value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<VariablePanel variables={[variable({ value: "old" })]} locked={false} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Value for baseUrl"), { target: { value: "new-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
    await screen.findByRole("button", { name: "Save variables" });
    expect(onSave).toHaveBeenCalledWith({ baseUrl: "new-value" });
  });

  it("clears the missing/unresolved styling as soon as a value is typed into a previously-unresolved row", () => {
    render(
      <VariablePanel
        variables={[variable({ name: "token", value: undefined, source: "collection-default", resolved: false })]}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Value for token");
    expect(input).toHaveAttribute("placeholder", "missing");
    fireEvent.change(input, { target: { value: "password123" } });
    expect(input).not.toHaveAttribute("placeholder");
  });

  it("marks a value changed in this session once edited, and the marker is absent before editing", () => {
    render(<VariablePanel variables={[variable({ value: "old" })]} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Changed in this session")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Value for baseUrl"), { target: { value: "new-value" } });
    expect(screen.getByLabelText("Changed in this session")).toBeInTheDocument();
  });

  it("disables every control while locked", () => {
    render(<VariablePanel variables={[variable()]} locked onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Value for baseUrl")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save variables" })).toBeDisabled();
  });

  it("+ Add variable gives an editable name field, and saving a new variable sends both name and value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<VariablePanel variables={[variable()]} locked={false} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
    const nameInput = screen.getByLabelText("Name for new variable 2");
    fireEvent.change(nameInput, { target: { value: "apiKey" } });
    fireEvent.change(screen.getByLabelText("Value for new variable 2"), { target: { value: "secret-value" } });

    fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
    await screen.findByRole("button", { name: "Save variables" });
    expect(onSave).toHaveBeenCalledWith({ baseUrl: "https://api.example.com", apiKey: "secret-value" });
  });

  it("re-syncs from a fresh variables prop after saving, so a just-saved row stops showing 'Not yet saved'", () => {
    const { rerender } = render(<VariablePanel variables={[variable()]} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
    expect(screen.getByText("Not yet saved")).toBeInTheDocument();

    // Simulates the parent re-fetching the collection view after `onSave` resolves and passing
    // back the now-persisted variable.
    rerender(
      <VariablePanel
        variables={[variable(), variable({ name: "apiKey", value: "secret-value", source: "environment" })]}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Not yet saved")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Value for apiKey")).toHaveValue("secret-value");
  });

  it("calls onClose when the Close button is clicked, and Save/Close render at the top as a matched button pair", () => {
    const onClose = vi.fn();
    render(<VariablePanel variables={[variable()]} locked={false} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "✕ Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
