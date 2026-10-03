import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReferenceField, type ReferenceSuggestion } from "../../src/components/requestChain/ReferenceField";

/** AP-037 (specs/037-request-chain-performance tasks T029; FR-005). */

const SUGGESTIONS: ReferenceSuggestion[] = [
  { name: "token", detail: "Extracted by Get a token" },
  { name: "customer_id", detail: "Extracted by Create a customer" },
  { name: "client_id", detail: "Environment value" },
  { name: "first_name", detail: "Data set column" },
  { name: "$guid", detail: "Generated per request" },
];

function Harness({ initial = "", onCommit = () => undefined }: { initial?: string; onCommit?: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ReferenceField label="Header value" value={value} onChange={setValue} onCommit={onCommit} suggestions={SUGGESTIONS} />
      <output data-testid="value">{value}</output>
    </>
  );
}

function type(text: string) {
  const field = screen.getByRole("combobox", { name: "Header value" }) as HTMLInputElement;
  fireEvent.change(field, { target: { value: text, selectionStart: text.length } });
  return field;
}

describe("ReferenceField", () => {
  it("offers every suggestion when {{ is typed, with where each comes from", () => {
    render(<Harness />);
    const field = type("Bearer {{");
    expect(field).toHaveAttribute("aria-expanded", "true");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "{{token}}Extracted by Get a token",
      "{{customer_id}}Extracted by Create a customer",
      "{{client_id}}Environment value",
      "{{first_name}}Data set column",
      "{{$guid}}Generated per request",
    ]);
    expect(field).toHaveAttribute("aria-activedescendant", options[0].id);
  });

  it("filters by what follows {{ and inserts with the keyboard, closing the braces", () => {
    render(<Harness />);
    const field = type("{{c");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByTestId("value")).toHaveTextContent("{{client_id}}");
    expect(field).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and offers nothing outside {{", () => {
    render(<Harness />);
    const field = type("Bearer ");
    expect(field).toHaveAttribute("aria-expanded", "false");
    type("{{t");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("value")).toHaveTextContent("{{t");
  });

  it("inserts on click and commits on blur", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const field = type("/customers/{{cus");
    fireEvent.mouseDown(screen.getByRole("option", { name: /customer_id/ }));
    expect(screen.getByTestId("value")).toHaveTextContent("/customers/{{customer_id}}");
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
