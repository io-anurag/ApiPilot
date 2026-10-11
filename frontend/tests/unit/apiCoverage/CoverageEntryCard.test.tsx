import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CoverageEntryCard } from "../../../src/components/apiCoverage/CoverageEntryCard";
import type { CoverageEntryState } from "../../../src/components/apiCoverage/coverageViewModel";

const ready: CoverageEntryState = {
  status: "ready",
  specification: "Petstore v1.2.0",
  specOperations: { numerator: 18, denominator: 23, percentage: 78.3 },
  runtimeOperations: { numerator: 10, denominator: 23, percentage: 43.5 },
  gaps: 9,
  highPriorityGaps: 3,
  hasRun: true,
};

describe("CoverageEntryCard panel (Import & Run Collection, AP-046)", () => {
  it("explains how a run feeds coverage and shows only the verified figure", () => {
    const onOpen = vi.fn();
    render(<CoverageEntryCard entry={ready} onOpen={onOpen} variant="panel" />);
    expect(screen.getByRole("heading", { name: "Feeds API Test Coverage" })).toBeInTheDocument();
    expect(screen.getByText("43.5%")).toBeInTheDocument();
    expect(screen.queryByText("Open gaps")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View coverage" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("disables the button and says why when there is no specification", () => {
    render(<CoverageEntryCard entry={{ status: "no-spec" }} onOpen={vi.fn()} variant="panel" />);
    expect(screen.getByRole("button", { name: "View coverage" })).toBeDisabled();
    expect(screen.getByText("Needs a specification from the Guided Workflow.")).toBeInTheDocument();
  });

  it("keeps the button usable after a failure, so the Coverage view can show and retry the error", () => {
    render(<CoverageEntryCard entry={{ status: "error", message: "down" }} onOpen={vi.fn()} variant="panel" />);
    expect(screen.getByRole("button", { name: "View coverage" })).toBeEnabled();
  });

  it("shows no figure while loading", () => {
    render(<CoverageEntryCard entry={{ status: "loading" }} onOpen={vi.fn()} variant="panel" />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking coverage");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
