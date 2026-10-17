import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StepTrail, type StepTrailItem } from "../../../src/components/patterns/StepTrail";

const ITEMS: StepTrailItem[] = [
  { id: "a", label: "Collection", hint: "Choose a collection", testId: "step-a" },
  { id: "b", label: "Review requests", hint: "Check each request", testId: "step-b" },
  { id: "c", label: "Run", hint: "Start a run", testId: "step-c" },
  { id: "d", label: "Results", hint: "Nothing yet", lockReason: "Finish a run first", testId: "step-d" },
];

function renderTrail(currentId = "b", onSelect = vi.fn(), extra: Partial<Parameters<typeof StepTrail>[0]> = {}) {
  render(<StepTrail ariaLabel="Progress" testId="trail" columns={4} items={ITEMS} currentId={currentId} onSelect={onSelect} {...extra} />);
  return onSelect;
}

describe("StepTrail (AP-054 FR-016)", () => {
  it("is a named list of buttons, with the open step marked current", () => {
    renderTrail("b");
    const nav = screen.getByRole("navigation", { name: "Progress" });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByTestId("step-b").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("step-a").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("says a finished step is done in words as well as the check", () => {
    renderTrail("c");
    const done = screen.getByTestId("step-a");
    expect(done).toHaveTextContent("Done");
    expect(done.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("step-c")).not.toHaveTextContent("Done");
  });

  it("shows the hint, or the lock reason in its place, as text", () => {
    renderTrail("a");
    expect(screen.getByTestId("step-b")).toHaveTextContent("Check each request");
    const locked = screen.getByTestId("step-d");
    expect(locked).toHaveTextContent("Finish a run first");
    expect(locked).not.toHaveTextContent("Nothing yet");
    expect(locked).toHaveAttribute("aria-disabled", "true");
  });

  it("selects an open step and never a locked one", () => {
    const onSelect = renderTrail("a");
    fireEvent.click(screen.getByTestId("step-c"));
    expect(onSelect).toHaveBeenCalledWith("c");
    onSelect.mockClear();
    fireEvent.click(screen.getByTestId("step-d"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("can name each button by its label alone and describe it with the hint, for views", () => {
    renderTrail("a", vi.fn(), { labelOnlyName: true, currentToken: "page" });
    const button = screen.getByRole("button", { name: "Review requests" });
    expect(button).toHaveAccessibleDescription("Check each request");
    expect(screen.getByRole("button", { name: "Collection" })).toHaveAttribute("aria-current", "page");
  });

  it("lets a step carry an icon and an explicit done state", () => {
    render(
      <StepTrail
        ariaLabel="Views"
        columns={3}
        currentId="x"
        onSelect={() => undefined}
        items={[
          { id: "x", label: "Script", hint: "Edit", icon: <i data-testid="icon-x" /> },
          { id: "y", label: "Setup", hint: "Ready", icon: <i data-testid="icon-y" />, done: true },
        ]}
      />,
    );
    expect(screen.getByTestId("icon-x")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-y")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Setup/ })).toHaveTextContent("Done");
  });
});
