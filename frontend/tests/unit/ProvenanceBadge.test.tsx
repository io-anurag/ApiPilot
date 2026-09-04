import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProvenanceBadge } from "../../src/components/ProvenanceBadge";

describe("ProvenanceBadge", () => {
  it("renders a distinguishable label for a rule-derived scenario", () => {
    render(<ProvenanceBadge source="RULE" />);
    expect(screen.getByTestId("provenance-badge")).toHaveTextContent("Deterministic rule");
  });

  it("renders a distinguishable label for an AI-derived scenario", () => {
    render(<ProvenanceBadge source="AI" />);
    expect(screen.getByTestId("provenance-badge")).toHaveTextContent("AI-suggested");
  });

  it("shows User-modified in place of the original provenance once a user has edited the scenario", () => {
    render(<ProvenanceBadge source="AI" modifiedByUser />);
    const badge = screen.getByTestId("provenance-badge");
    expect(badge).toHaveTextContent("User-modified");
    expect(badge).not.toHaveTextContent("AI-suggested");
  });
});
