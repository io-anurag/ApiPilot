import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadProfileChart } from "../../src/components/performance/LoadProfileChart";
import { loadProfilePoints } from "../../src/components/performance/performanceViewModel";

/** AP-040: the Run setup load profile chart and the points it draws. */

describe("loadProfilePoints", () => {
  it("starts at the one virtual user k6 starts with and ends each stage at its target", () => {
    expect(
      loadProfilePoints([
        { durationMs: 30_000, targetVirtualUsers: 10 },
        { durationMs: 60_000, targetVirtualUsers: 0 },
      ]),
    ).toEqual([
      { seconds: 0, virtualUsers: 1 },
      { seconds: 30, virtualUsers: 10 },
      { seconds: 90, virtualUsers: 0 },
    ]);
  });
});

describe("LoadProfileChart", () => {
  it("describes the plan in words, with the stage count, duration and peak", () => {
    render(<LoadProfileChart stages={[{ durationMs: 60_000, targetVirtualUsers: 10 }]} />);
    expect(screen.getByRole("img", { name: "Planned virtual users over 01:00: 1 stage, peaking at 10." })).toBeInTheDocument();
  });

  it("draws nothing for a plan with no duration", () => {
    const { container } = render(<LoadProfileChart stages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
