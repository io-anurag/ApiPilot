import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecurityLabPage } from "../../../src/pages/SecurityLabPage";

function renderPage(props: Partial<React.ComponentProps<typeof SecurityLabPage>> = {}) {
  const onAreaChange = vi.fn();
  render(<SecurityLabPage specificationLoaded={true} area={undefined} onAreaChange={onAreaChange} {...props} />);
  return { onAreaChange };
}

describe("SecurityLabPage shell (FR-001 to FR-004)", () => {
  it("titles the page Security Lab and offers the four areas as keyboard-reachable buttons", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Security Lab" })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Security Lab areas" }));
    expect(nav.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Overview",
      "Scenarios",
      "Execution and Findings",
      "Reports",
    ]);
  });

  it("shows Overview for the bare address and marks it as the current area", () => {
    renderPage({ area: undefined });
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("security-area-overview")).toBeInTheDocument();
  });

  it("shows the addressed area", () => {
    renderPage({ area: "reports" });
    expect(screen.getByRole("button", { name: "Reports" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("security-area-reports")).toBeInTheDocument();
  });

  it("shows the Scenarios area, not a placeholder", () => {
    renderPage({ area: "scenarios" });
    expect(within(screen.getByTestId("security-area-scenarios")).getByTestId("security-scenarios")).toBeInTheDocument();
    expect(screen.queryByText("Scenarios is not available yet.")).not.toBeInTheDocument();
  });

  it("shows the Execution and Findings area, not a placeholder", () => {
    renderPage({ area: "execution" });
    expect(within(screen.getByTestId("security-area-execution")).getByTestId("security-execution")).toBeInTheDocument();
    expect(screen.queryByText("Execution and Findings is not available yet.")).not.toBeInTheDocument();
  });

  it("asks the shell to change the address when an area is chosen", () => {
    const { onAreaChange } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Scenarios" }));
    expect(onAreaChange).toHaveBeenCalledWith("scenarios");
  });

  it("says no specification is loaded, and that retained work stays readable, without hiding the areas", () => {
    renderPage({ specificationLoaded: false });
    const notice = screen.getByTestId("security-spec-not-loaded");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("No specification is loaded");
    expect(notice).toHaveTextContent("specification not loaded");
    expect(screen.getByRole("navigation", { name: "Security Lab areas" })).toBeInTheDocument();
    expect(screen.getByTestId("security-area-overview")).toBeInTheDocument();
  });

  it("shows a loading state, not an empty one, until the workflow has been read", () => {
    renderPage({ specificationLoaded: null });
    expect(screen.getByRole("status", { name: "Loading Security Lab" })).toBeInTheDocument();
    expect(screen.queryByTestId("security-area-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-spec-not-loaded")).not.toBeInTheDocument();
  });

  it("does not show the notice when a specification is loaded", () => {
    renderPage({ specificationLoaded: true });
    expect(screen.queryByTestId("security-spec-not-loaded")).not.toBeInTheDocument();
  });
});
