import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { AppShell } from "../../../src/components/shell/AppShell";
import type { Route } from "../../../src/navigation/routes";

const BASE = {
  route: { view: "home" } as Route,
  workflow: null as TestGenerationWorkflow | null,
  viewedStage: null,
  notice: null as string | null,
  health: null as Parameters<typeof AppShell>[0]["health"],
  theme: "light" as const,
  onThemeChange: () => undefined,
  onOpenCommandPalette: () => undefined,
  shortcutHint: "Ctrl K",
  onNavigate: () => undefined,
};

function renderShell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <AppShell {...BASE} {...overrides}>
      <p>page content</p>
    </AppShell>,
  );
}

describe("AppShell (AP-054 FR-001, FR-004)", () => {
  it("orders the landmarks: skip link, primary navigation, header, then main", () => {
    renderShell();
    const shell = screen.getByTestId("app-shell");
    const order = [
      screen.getByRole("link", { name: "Skip to main content" }),
      screen.getByRole("navigation", { name: "Primary" }),
      screen.getByRole("banner"),
      screen.getByRole("main"),
    ];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(shell).toContainElement(order[3]);
    expect(within(order[3]).getByText("page content")).toBeInTheDocument();
    expect(order[3]).toHaveAttribute("id", "main");
  });

  it("the skip link focuses the main region without changing the address", () => {
    renderShell();
    window.history.replaceState(null, "", "/#/coverage");
    fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.location.hash).toBe("#/coverage");
  });

  it("names the screen in the header, with its parent as a breadcrumb", () => {
    renderShell({ route: { view: "guided", stage: "scenarioReview" } });
    expect(screen.getByRole("heading", { level: 1, name: "Scenario Review" })).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("Guided Workflow › Design")).toBeInTheDocument();
  });

  it.each([
    [null, "Connecting"],
    [{ ok: true, data: { status: "ok", timestamp: "2026-08-26T12:00:00.000Z" } }, "Connected"],
    [{ ok: false, error: "network error" }, "Disconnected"],
  ] as const)("shows the connection status in words (%#)", (health, words) => {
    renderShell({ health: health as Parameters<typeof AppShell>[0]["health"] });
    const status = screen.getByTestId("connection-status");
    expect(status).toHaveTextContent(words);
    if (words === "Disconnected") expect(status).toHaveAttribute("role", "alert");
    else expect(status).not.toHaveAttribute("role", "alert");
  });

  it("offers the command palette with its shortcut, the theme control and help", () => {
    const onOpenCommandPalette = vi.fn();
    renderShell({ onOpenCommandPalette });
    const palette = screen.getByRole("button", { name: "Open command palette" });
    expect(palette).toHaveTextContent("Ctrl K");
    fireEvent.click(palette);
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("group", { name: "Color theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keyboard shortcuts and help" })).toBeInTheDocument();
  });

  it("opens the help dialog and returns focus to the help button when it closes (FR-021)", () => {
    renderShell();
    const help = screen.getByRole("button", { name: "Keyboard shortcuts and help" });
    help.focus();
    fireEvent.click(help);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts and workflows" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("help-dialog")).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });

  it("shows a route notice in a polite live region, and keeps the region when there is none", () => {
    const { rerender } = renderShell();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(
      <AppShell {...BASE} notice="Complete AI Enhancement first.">
        <p>page content</p>
      </AppShell>,
    );
    expect(screen.getByTestId("route-notice")).toHaveTextContent("Complete AI Enhancement first.");
  });
});
