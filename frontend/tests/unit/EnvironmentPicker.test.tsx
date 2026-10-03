import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Environment } from "@apipilot/shared-domain";
import { EnvironmentPicker } from "../../src/components/performance/EnvironmentPicker";

/** The target environment picker shared by the performance screens (AP-029 FR-013; AP-037 FR-029). */

const LOCAL = { id: "env-1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: {}, requestDelayMs: 0 } as unknown as Environment;

describe("EnvironmentPicker", () => {
  it("shows that no environment is chosen instead of showing the first one", () => {
    const onSelect = vi.fn();
    render(<EnvironmentPicker environments={[LOCAL]} selectedId={null} suggestedNames={[]} onSelect={onSelect} onSaved={vi.fn()} />);
    const select = screen.getByLabelText("Target environment") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]).toHaveTextContent("Choose an environment");
    expect(screen.queryByText("Tier: local")).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "env-1" } });
    expect(onSelect).toHaveBeenCalledWith("env-1");
  });

  it("offers no placeholder once an environment is chosen", () => {
    render(<EnvironmentPicker environments={[LOCAL]} selectedId="env-1" suggestedNames={[]} onSelect={vi.fn()} onSaved={vi.fn()} />);
    const select = screen.getByLabelText("Target environment") as HTMLSelectElement;
    expect(select.value).toBe("env-1");
    expect(screen.queryByText("Choose an environment")).not.toBeInTheDocument();
  });
});
