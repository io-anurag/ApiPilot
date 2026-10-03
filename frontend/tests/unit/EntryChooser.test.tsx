import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EntryChooser } from "../../src/components/EntryChooser";
import { WORKFLOWS } from "../../src/components/workflowCatalog";

describe("EntryChooser (AP-038 US1)", () => {
  it("shows the Design A hero and the workflow section headings (FR-008, FR-010)", () => {
    render(<EntryChooser onSelect={vi.fn()} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Start with the artifact you have." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Launch a test session" })).toBeInTheDocument();
    expect(screen.getByText("Choose a workflow")).toBeInTheDocument();
    expect(screen.getByText("Your work remains available for this browser session.")).toBeInTheDocument();
  });

  it("names, for each artifact, the workflows that accept it (FR-009)", () => {
    render(<EntryChooser onSelect={vi.fn()} />);
    const names = (group: string) =>
      within(screen.getByRole("group", { name: group }))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));

    expect(names("OpenAPI specification")).toEqual([
      "Guided Workflow, for an OpenAPI specification",
      "Quick performance test, for an OpenAPI specification",
    ]);
    expect(names("Postman collection")).toEqual(["Import & Run Collection, for a Postman collection"]);
    expect(names("k6 script")).toEqual(["Run k6 Script, for a k6 script"]);
  });

  it("opens the same workflow from an artifact choice as from its card (SC-002)", () => {
    const onSelect = vi.fn();
    render(<EntryChooser onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Quick performance test, for an OpenAPI specification" }));
    fireEvent.click(screen.getByRole("button", { name: "Quick performance test" }));
    fireEvent.click(screen.getByRole("button", { name: "Import & Run Collection, for a Postman collection" }));
    fireEvent.click(screen.getByRole("button", { name: "Run k6 Script, for a k6 script" }));

    expect(onSelect.mock.calls).toEqual([
      ["quick-performance"],
      ["quick-performance"],
      ["import-collection"],
      ["user-script"],
    ]);
  });

  it("shows the five cards in tab order, each named by its title and described by its sentence (FR-011)", () => {
    const onSelect = vi.fn();
    render(<EntryChooser onSelect={onSelect} />);

    for (const workflow of WORKFLOWS) {
      const card = screen.getByRole("button", { name: workflow.title });
      expect(card).toHaveAccessibleDescription(workflow.description);
      fireEvent.click(card);
    }
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(WORKFLOWS.map((w) => w.id));
  });

  it("marks only the guided workflow as recommended, in text", () => {
    render(<EntryChooser onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Guided Workflow" })).toHaveTextContent("Recommended");
    expect(screen.getAllByText("Recommended")).toHaveLength(1);
  });

  it("hides the decorative illustration from assistive technology", () => {
    render(<EntryChooser onSelect={vi.fn()} />);
    const illustrationLabel = screen.getByText("Postman collection", { selector: "span" });
    expect(illustrationLabel.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
