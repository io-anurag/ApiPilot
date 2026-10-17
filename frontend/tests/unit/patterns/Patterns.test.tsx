import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Banner } from "../../../src/components/patterns/Banner";
import { Card, CardHeader } from "../../../src/components/patterns/Card";
import { DropZone } from "../../../src/components/patterns/DropZone";
import { KeyValueGrid } from "../../../src/components/patterns/KeyValueGrid";
import { Pill } from "../../../src/components/patterns/Pill";
import { TaskCard } from "../../../src/components/patterns/TaskCard";
import { StatTile } from "../../../src/components/StatTile";

describe("Card (AP-054 FR-014)", () => {
  it("renders its element, children and a titled header", () => {
    render(
      <Card as="section" aria-labelledby="t">
        <CardHeader title="Recent runs" titleId="t" subtitle="Newest first" actions={<button type="button">Refresh</button>} />
        <p>body</p>
      </Card>,
    );
    const card = screen.getByRole("region", { name: "Recent runs" });
    expect(card).toHaveTextContent("body");
    expect(screen.getByRole("heading", { level: 2, name: "Recent runs" })).toBeInTheDocument();
    expect(screen.getByText("Newest first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("supports a nested heading level and a flat variant", () => {
    render(
      <Card variant="flat" data-testid="flat">
        <CardHeader title="Nested" level={3} />
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Nested" })).toBeInTheDocument();
    expect(screen.getByTestId("flat").className).toContain("bg-surface-subtle");
    expect(screen.getByTestId("flat").className).not.toContain("shadow");
  });
});

describe("Pill", () => {
  it.each(["accent", "mint", "line", "ok", "warn", "bad"] as const)("renders its text for the %s tone", (tone) => {
    render(<Pill tone={tone}>Label</Pill>);
    expect(screen.getByText("Label")).toHaveAttribute("data-tone", tone);
  });

  it("can carry an icon beside the text for a status", () => {
    render(
      <Pill tone="bad" icon={<svg data-testid="icon" aria-hidden="true" />}>
        Failed
      </Pill>,
    );
    expect(screen.getByText("Failed")).toContainElement(screen.getByTestId("icon"));
  });
});

describe("TaskCard", () => {
  it("is a link with href, a button with onClick, and plain content with neither", () => {
    const onClick = vi.fn();
    const { rerender } = render(<TaskCard title="Review 3 scenarios" detail="Scenario Review" href="#/guided/scenarioReview" />);
    expect(screen.getByRole("link", { name: /Review 3 scenarios/ })).toHaveAttribute("href", "#/guided/scenarioReview");
    rerender(<TaskCard title="Review 3 scenarios" detail="Scenario Review" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /Review 3 scenarios/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<TaskCard title="Nothing is waiting on you." testId="plain" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("plain")).toHaveTextContent("Nothing is waiting on you.");
  });

  it("highlights with the accent and dark text, never white on lime", () => {
    render(<TaskCard title="Next" highlighted testId="hi" />);
    const className = screen.getByTestId("hi").className;
    expect(className).toContain("bg-accent");
    expect(className).toContain("text-on-accent");
    expect(className).not.toContain("text-white");
  });
});

describe("Banner", () => {
  it.each([
    ["warning", undefined],
    ["neutral", "status"],
    ["error", "alert"],
  ] as const)("shows a %s banner with its title as text", (tone, role) => {
    render(
      <Banner tone={tone} title="Something to know" role={role} testId="banner">
        More detail
      </Banner>,
    );
    const banner = screen.getByTestId("banner");
    expect(banner).toHaveAttribute("data-tone", tone);
    expect(banner).toHaveTextContent("Something to know");
    expect(banner).toHaveTextContent("More detail");
    expect(banner.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    if (role) expect(screen.getByRole(role)).toBe(banner);
  });

  it("omits the body when there is none", () => {
    render(<Banner title="Only a title" testId="banner" />);
    expect(screen.getByTestId("banner").querySelectorAll("p")).toHaveLength(1);
  });
});

describe("DropZone", () => {
  it("is a label around a reachable file input, and forwards drag handlers", () => {
    const onDrop = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <DropZone title="Drag and drop here" hint="or click to browse" onDrop={onDrop}>
        <input type="file" className="sr-only" aria-label="Pick a file" />
      </DropZone>,
    );
    const input = screen.getByLabelText("Pick a file");
    const zone = input.closest("label") as HTMLElement;
    expect(zone).toHaveTextContent("Drag and drop here");
    expect(zone).toHaveTextContent("or click to browse");
    fireEvent.drop(zone);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("marks an active drop and mutes a disabled one", () => {
    const { rerender } = render(<DropZone title="Drop" active data-testid="zone" />);
    expect(screen.getByTestId("zone")).toHaveAttribute("data-active", "true");
    rerender(<DropZone title="Drop" disabled data-testid="zone" />);
    expect(screen.getByTestId("zone").className).toContain("cursor-not-allowed");
  });
});

describe("KeyValueGrid", () => {
  it("is a description list of labelled values with optional detail", () => {
    render(<KeyValueGrid items={[{ label: "Operations", value: "42", detail: "3 deprecated" }, { label: "Spec", value: "orders.yaml" }]} />);
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual(["Operations", "Spec"]);
    expect(screen.getAllByRole("definition").map((d) => d.textContent)).toEqual(["42", "3 deprecated", "orders.yaml"]);
  });
});

describe("StatTile highlight (AP-054)", () => {
  it("is mint when highlighted, white otherwise, and keeps its term and description", () => {
    const { rerender } = render(
      <dl>
        <StatTile label="Operations" value="42" highlight />
      </dl>,
    );
    expect(screen.getByTestId("stat-tile")).toHaveAttribute("data-highlight", "true");
    expect(screen.getByTestId("stat-tile").className).toContain("bg-mint");
    rerender(
      <dl>
        <StatTile label="Operations" value="42" />
      </dl>,
    );
    expect(screen.getByTestId("stat-tile")).not.toHaveAttribute("data-highlight");
    expect(screen.getByRole("term")).toHaveTextContent("Operations");
    expect(screen.getByRole("definition")).toHaveTextContent("42");
  });
});
