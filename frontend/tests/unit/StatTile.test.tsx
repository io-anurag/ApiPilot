import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "../../src/components/StatTile";

describe("StatTile", () => {
  it("renders a label and its value as a term and a description", () => {
    render(
      <dl>
        <StatTile label="Requests done" value="1,204" />
      </dl>,
    );
    expect(screen.getByRole("term")).toHaveTextContent("Requests done");
    expect(screen.getByRole("definition")).toHaveTextContent("1,204");
  });

  it("shows the sub-line only when given", () => {
    const { rerender } = render(
      <dl>
        <StatTile label="Elapsed" value="00:42" />
      </dl>,
    );
    expect(screen.getAllByRole("definition")).toHaveLength(1);
    rerender(
      <dl>
        <StatTile label="Elapsed" value="00:42" sub="of 02:00 planned" />
      </dl>,
    );
    expect(screen.getByText("of 02:00 planned")).toBeInTheDocument();
  });

  it("records its tone without replacing the text", () => {
    render(
      <dl>
        <StatTile label="Failures" value="3" tone="danger" />
      </dl>,
    );
    expect(screen.getByTestId("stat-tile")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText("Failures")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
