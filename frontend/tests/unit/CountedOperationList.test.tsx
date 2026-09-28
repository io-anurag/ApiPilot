import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CountedOperationList } from "../../src/components/performance/CountedOperationList";

/** AP-032 FR-024, US5 (specs/032-quick-performance-test research Q11, tasks T067). */

function entries(count: number) {
  return Array.from({ length: count }, (_, index) => ({ operationKey: `DELETE /items/${index}`, detail: "No positive scenario" }));
}

describe("CountedOperationList", () => {
  it("starts collapsed with its count when longer than ten entries", () => {
    render(<CountedOperationList label={(count) => `${count} operations left out`} entries={entries(30)} testId="list" />);
    const list = screen.getByTestId("list");
    expect(list.tagName).toBe("DETAILS");
    expect(list).not.toHaveAttribute("open");
    expect(within(list).getByText("30 operations left out").tagName).toBe("SUMMARY");
  });

  it("renders ten or fewer entries open, one operation per line with its method badge, path and reason", () => {
    render(<CountedOperationList label={(count) => `${count} operations left out`} entries={entries(10)} testId="list" />);
    const list = screen.getByTestId("list");
    expect(list.tagName).not.toBe("DETAILS");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(10);
    expect(within(rows[3]).getByTestId("http-method-badge")).toHaveTextContent("DELETE");
    expect(rows[3]).toHaveTextContent("/items/3");
    expect(rows[3]).toHaveTextContent("No positive scenario");
  });

  it("renders an action per entry, such as Restore", () => {
    render(
      <CountedOperationList
        label={(count) => `${count} removed`}
        entries={[{ operationKey: "POST /auth/login", action: <button type="button">Restore</button> }]}
        testId="list"
      />,
    );
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("never collapses with collapseAbove={Infinity}, as the write lists must not (SC-002)", () => {
    render(<CountedOperationList label={(count) => `${count} writes`} entries={entries(30)} collapseAbove={Infinity} testId="list" />);
    const list = screen.getByTestId("list");
    expect(list.tagName).not.toBe("DETAILS");
    expect(within(list).getAllByRole("listitem")).toHaveLength(30);
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<CountedOperationList label={() => "none"} entries={[]} testId="list" />);
    expect(container).toBeEmptyDOMElement();
  });
});
