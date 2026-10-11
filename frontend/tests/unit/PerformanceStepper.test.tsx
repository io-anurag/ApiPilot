import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PerformanceStepper } from "../../src/components/performance/path/PerformanceStepper";

describe("PerformanceStepper (FR-006, FR-008)", () => {
  it("names the five steps and marks the open one with aria-current", () => {
    render(<PerformanceStepper current="operations" reached={1} source="specification" onSelect={() => undefined} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("navigation", { name: "Performance test progress" })).toBeInTheDocument();
    const current = screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Operations");
  });

  it("lets a reached step be selected and says in text why a later one cannot", () => {
    const onSelect = vi.fn();
    render(<PerformanceStepper current="operations" reached={1} source="specification" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("performance-step-source"));
    expect(onSelect).toHaveBeenCalledWith("source");
    const plan = screen.getByTestId("performance-step-plan");
    expect(plan).toHaveAttribute("aria-disabled", "true");
    expect(plan).toHaveTextContent("Finish the earlier steps first");
    fireEvent.click(plan);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows every step as reachable on an opened plan", () => {
    render(<PerformanceStepper current="plan" reached={4} source="specification" onSelect={() => undefined} />);
    for (const step of ["source", "operations", "plan", "load", "run"]) expect(screen.getByTestId(`performance-step-${step}`)).not.toHaveAttribute("aria-disabled");
  });

  it("names the Operations step for its source and shows it skipped for an empty plan", () => {
    const { rerender } = render(<PerformanceStepper current="plan" reached={4} source="collection" onSelect={() => undefined} />);
    expect(screen.getByTestId("performance-step-operations")).toHaveTextContent("Requests");
    rerender(<PerformanceStepper current="plan" reached={4} source="workflow" onSelect={() => undefined} />);
    expect(screen.getByTestId("performance-step-operations")).toHaveTextContent("Workflows");
    rerender(<PerformanceStepper current="plan" reached={4} source="empty" onSelect={() => undefined} />);
    const skipped = screen.getByTestId("performance-step-operations");
    expect(skipped).toHaveAttribute("aria-disabled", "true");
    expect(skipped).toHaveTextContent("Skipped for an empty plan");
  });
});
