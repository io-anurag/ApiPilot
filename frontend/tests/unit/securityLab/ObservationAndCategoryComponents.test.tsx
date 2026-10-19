import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryTable } from "../../../src/components/securityLab/CategoryTable";
import { ObservationList } from "../../../src/components/securityLab/ObservationList";
import { CATEGORIES, observation } from "./securityFixtures";

describe("ObservationList (FR-008)", () => {
  it("shows each observation's classification as text, its operation, rationale, source element and origin", () => {
    render(
      <ObservationList
        caption="Observations"
        observations={[
          observation({ id: "a", classification: "potential-risk", basis: "path-token", origin: "documented" }),
          observation({ id: "b", operationKey: undefined, elementPointer: "/securitySchemes", classification: "not-measurable", origin: "observed" }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("observation-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Potential risk")).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText("HTTP method GET")).toBeInTheDocument();
    expect(within(rows[0]).getByText("/public/status")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/public on purpose/)).toBeInTheDocument();
    expect(within(rows[0]).getByText("/operations/GET /public/status/security")).toBeInTheDocument();
    expect(within(rows[0]).getByText("path segment")).toBeInTheDocument();
    expect(within(rows[0]).getByTestId("fact-origin-badge")).toHaveAttribute("data-origin", "documented");
    expect(within(rows[1]).getByText("Not measurable")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Whole specification")).toBeInTheDocument();
    expect(within(rows[1]).getByTestId("fact-origin-badge")).toHaveAttribute("data-origin", "observed");
  });

  it("is a labelled, keyboard-scrollable table with column headers", () => {
    render(<ObservationList caption="Potential risks" observations={[observation()]} />);
    const region = screen.getByRole("region", { name: "Potential risks" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Classification",
      "Operation",
      "Why it was raised",
      "Source element",
      "Basis and origin",
    ]);
  });

  it("says plainly when a group is empty", () => {
    render(<ObservationList caption="x" observations={[]} emptyMessage="Nothing was raised." testId="risks" />);
    expect(screen.getByTestId("risks-empty")).toHaveTextContent("Nothing was raised.");
  });

  it("pages a long list and keeps the total visible", () => {
    const many = Array.from({ length: 23 }, (_, i) => observation({ id: `so-${i}`, elementPointer: `/operations/GET /x${i}/security`, operationKey: `GET /x${i}` }));
    render(<ObservationList caption="many" observations={many} />);
    expect(screen.getAllByTestId("observation-row")).toHaveLength(10);
    expect(screen.getByTestId("observation-list-pagination")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getAllByTestId("observation-row")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getAllByTestId("observation-row")).toHaveLength(3);
  });

  it("does not page a short list", () => {
    render(<ObservationList caption="few" observations={[observation()]} />);
    expect(screen.queryByTestId("observation-list-pagination")).not.toBeInTheDocument();
  });
});

describe("CategoryTable (FR-012 to FR-015)", () => {
  it("shows support level and taxonomy as separate columns, with the row header naming the category", () => {
    render(<CategoryTable categories={CATEGORIES} editionTitle="OWASP API Security Top 10 (2023)" />);
    const rows = screen.getAllByTestId("category-row");
    expect(rows).toHaveLength(4);
    const authentication = rows.find((row) => row.getAttribute("data-category") === "authentication");
    expect(within(authentication!).getByRole("rowheader", { name: "Authentication" })).toBeInTheDocument();
    expect(within(authentication!).getByText("Supported")).toBeInTheDocument();
    expect(within(authentication!).getByText("API2")).toBeInTheDocument();
    expect(within(authentication!).getByText(/Yes, when its prerequisites are met/)).toBeInTheDocument();
  });

  it("marks a related mapping as ApiPilot's judgement, in the row and in a note", () => {
    render(<CategoryTable categories={CATEGORIES} editionTitle="OWASP API Security Top 10 (2023)" />);
    const row = screen.getAllByTestId("category-row").find((r) => r.getAttribute("data-category") === "input-validation")!;
    expect(within(row).getByText("(related)")).toBeInTheDocument();
    expect(screen.getByText(/ApiPilot’s own judgement/)).toBeInTheDocument();
  });

  it("says that limited and analysis-only categories cannot run, and why", () => {
    render(<CategoryTable categories={CATEGORIES} editionTitle="OWASP 2023" />);
    const ssrf = screen.getAllByTestId("category-row").find((r) => r.getAttribute("data-category") === "ssrf-unsafe-consumption")!;
    expect(within(ssrf).getByText("Limited")).toBeInTheDocument();
    expect(within(ssrf).getByText("No")).toBeInTheDocument();
    expect(within(ssrf).getByText("No reliable detection is claimed.")).toBeInTheDocument();
    const inventory = screen.getAllByTestId("category-row").find((r) => r.getAttribute("data-category") === "api-inventory")!;
    expect(within(inventory).getByText("Analysis only")).toBeInTheDocument();
  });

  it("omits the judgement note when no mapping is a judgement", () => {
    render(<CategoryTable categories={[CATEGORIES[0]]} editionTitle="OWASP 2023" />);
    expect(screen.queryByText(/ApiPilot’s own judgement/)).not.toBeInTheDocument();
  });
});
