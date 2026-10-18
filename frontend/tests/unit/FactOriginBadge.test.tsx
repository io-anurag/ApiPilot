import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactOriginBadge } from "../../src/components/FactOriginBadge";

describe("FactOriginBadge (specs/056 FR-043)", () => {
  it.each([
    ["documented", "Documented"],
    ["declared", "Declared"],
  ] as const)("shows %s as text without a count", (origin, text) => {
    render(<FactOriginBadge origin={origin} observationCount={9} confidence="high" />);
    const badge = screen.getByTestId("fact-origin-badge");
    expect(badge).toHaveTextContent(text);
    expect(badge).not.toHaveTextContent("×");
    expect(badge).toHaveAttribute("data-origin", origin);
  });

  it("shows an observed fact with its observation count and confidence as text", () => {
    render(<FactOriginBadge origin="observed" observationCount={12} confidence="high" />);
    const badge = screen.getByTestId("fact-origin-badge");
    expect(badge).toHaveTextContent("Observed ×12");
    expect(badge).toHaveTextContent("high");
    expect(screen.getByLabelText("Observed, 12 observations, high confidence")).toBe(badge);
  });

  it("uses the singular for one observation and says the confidence is low", () => {
    render(<FactOriginBadge origin="inferred" observationCount={1} confidence="low" />);
    expect(screen.getByLabelText("Inferred, 1 observation, low confidence")).toHaveTextContent("Inferred ×1");
  });

  it("explains each origin in its tooltip so the label is never the only signal", () => {
    render(
      <>
        <FactOriginBadge origin="observed" observationCount={2} />
        <FactOriginBadge origin="inferred" observationCount={3} />
      </>,
    );
    const [observed, inferred] = screen.getAllByTestId("fact-origin-badge");
    expect(observed).toHaveAttribute("title", expect.stringContaining("not a guarantee"));
    expect(inferred).toHaveAttribute("title", expect.stringContaining("Derived by ApiPilot"));
  });

  it("omits the confidence word when none is given", () => {
    render(<FactOriginBadge origin="observed" observationCount={4} />);
    expect(screen.getByTestId("fact-origin-badge")).toHaveTextContent(/^Observed ×4$/);
  });
});
