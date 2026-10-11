import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toOperationKey } from "@apipilot/shared-domain";
import { OperationSelection } from "../../src/components/requestChain/OperationSelection";
import { quickTestView } from "./performanceFixtures";

const operations = quickTestView().specification.operations as Parameters<typeof OperationSelection>[0]["operations"];

function Harness({ initial }: Readonly<{ initial?: readonly string[] }>) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(initial ?? operations.map(toOperationKey)));
  return <OperationSelection operations={operations} checkedKeys={checked} onChange={setChecked} />;
}

describe("OperationSelection filters (specs/047 R12, constitution XXXII)", () => {
  it("shows the chosen-of-total count and every row by default", () => {
    render(<Harness />);
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: /^(GET|POST|DELETE) / })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Select shown/ })).not.toBeInTheDocument();
  });

  it("narrows the rows by path or operation id and says how many are shown", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Filter operations"), { target: { value: "customers/{id}" } });
    expect(screen.getByRole("checkbox", { name: "DELETE /customers/{id}" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "GET /customers" })).not.toBeInTheDocument();
    expect(screen.getByText("3 of 3 selected, showing 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter operations"), { target: { value: "listcustomers" } });
    expect(screen.getByRole("checkbox", { name: "GET /customers" })).toBeInTheDocument();
  });

  it("narrows the rows by method and lists the methods present", () => {
    render(<Harness />);
    const method = screen.getByLabelText("Filter by method");
    expect(within(method).getAllByRole("option").map((option) => option.textContent)).toEqual(["All methods", "DELETE", "GET", "POST"]);
    fireEvent.change(method, { target: { value: "POST" } });
    expect(screen.getAllByRole("checkbox", { name: /^POST / })).toHaveLength(1);
    expect(screen.queryByRole("checkbox", { name: /^GET / })).not.toBeInTheDocument();
  });

  it("selects and clears only the shown rows, while Select all still acts on every operation", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText("0 of 3 selected")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by method"), { target: { value: "GET" } });
    fireEvent.click(screen.getByRole("button", { name: "Select shown (1)" }));
    expect(screen.getByText("1 of 3 selected, showing 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear shown" }));
    expect(screen.getByText("0 of 3 selected, showing 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select all/ }));
    expect(screen.getByText("3 of 3 selected, showing 1")).toBeInTheDocument();
  });

  it("says when no operation matches", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Filter operations"), { target: { value: "zzz" } });
    expect(screen.getByText("No operations match the filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select shown (0)" })).toBeDisabled();
  });
});
