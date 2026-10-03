import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { StepCheck } from "@apipilot/shared-domain";
import { CheckRows } from "../../src/components/requestChain/CheckRows";

/** AP-037 (specs/037-request-chain-performance tasks T061; US3, FR-016). */

function Harness({ initial, onCommit = () => undefined }: { initial: StepCheck[]; onCommit?: () => void }) {
  const [checks, setChecks] = useState(initial);
  let next = 10;
  return (
    <>
      <CheckRows
        checks={checks}
        suggestions={[{ name: "customer_id", detail: "Extracted by Create" }]}
        onChange={setChecks}
        onCommit={onCommit}
        onAdd={(kind) => {
          const id = `k${next++}`;
          setChecks((current) => [...current, kind === "time-at-most" ? { id, kind, maxMs: 500 } : kind === "body-contains" ? { id, kind, text: "" } : kind === "field-exists" ? { id, kind, path: "" } : { id, kind, path: "", expected: { type: "text", value: "" } }]);
        }}
      />
      <output data-testid="checks">{JSON.stringify(checks)}</output>
    </>
  );
}

describe("CheckRows", () => {
  it("adds each of the four kinds of check", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/No checks/)).toBeInTheDocument();
    const kind = screen.getByLabelText("Kind of check");
    for (const option of ["field-exists", "field-equals", "body-contains", "time-at-most"]) {
      fireEvent.change(kind, { target: { value: option } });
      fireEvent.click(screen.getByRole("button", { name: "+ Add check" }));
    }
    expect(screen.getByText("1. JSON field exists")).toBeInTheDocument();
    expect(screen.getByText("2. JSON field equals")).toBeInTheDocument();
    expect(screen.getByText("3. Body contains text")).toBeInTheDocument();
    expect(screen.getByText("4. Response time at most")).toBeInTheDocument();
  });

  it("shows problems in text: a bad field path, empty text and an out-of-range time", () => {
    render(
      <Harness
        initial={[
          { id: "k1", kind: "field-exists", path: "items[*].id" },
          { id: "k2", kind: "body-contains", text: "" },
          { id: "k3", kind: "time-at-most", maxMs: 0 },
        ]}
      />,
    );
    const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent);
    expect(alerts[0]).toMatch(/array position/);
    expect(alerts[1]).toBe("Enter the text to look for.");
    expect(alerts[2]).toBe("A whole number of milliseconds from 1 to 600000.");
  });

  it("switches an equals check's type and keeps a reference in a text value", () => {
    const onCommit = vi.fn();
    render(<Harness initial={[{ id: "k1", kind: "field-equals", path: "id", expected: { type: "text", value: "{{customer_id}}" } }]} onCommit={onCommit} />);
    expect(screen.getByRole("combobox", { name: "Check 1 expected value" })).toHaveValue("{{customer_id}}");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "boolean" } });
    expect(onCommit).toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId("checks").textContent!)[0].expected).toEqual({ type: "boolean", value: false });
  });

  it("removes a check and stops adding at ten", () => {
    const ten = Array.from({ length: 10 }, (_unused, index): StepCheck => ({ id: `k${index + 1}`, kind: "time-at-most", maxMs: 100 }));
    render(<Harness initial={ten} />);
    expect(screen.getByRole("button", { name: "+ Add check" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove check 1" }));
    expect(screen.getByRole("button", { name: "+ Add check" })).toBeEnabled();
  });
});
