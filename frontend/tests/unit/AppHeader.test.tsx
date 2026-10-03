import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppHeader } from "../../src/components/AppHeader";

const themeProps = {
  theme: "light" as const,
  onThemeChange: () => undefined,
  onOpenCommandPalette: () => undefined,
  shortcutHint: "Ctrl K",
};

describe("AppHeader", () => {
  it("shows a connecting indicator while the health check is pending", () => {
    render(<AppHeader health={null} {...themeProps} />);
    expect(screen.getByText("ApiPilot")).toBeInTheDocument();
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Connecting");
  });

  it("shows a connected status once the health check succeeds", () => {
    render(
      <AppHeader
        health={{ ok: true, data: { status: "ok", timestamp: "2026-08-26T12:00:00.000Z" } }}
        {...themeProps}
      />,
    );
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Connected");
  });

  it("shows a disconnected status, as an alert, when the health check fails", () => {
    render(<AppHeader health={{ ok: false, error: "network error" }} {...themeProps} />);
    const status = screen.getByTestId("connection-status");
    expect(status).toHaveTextContent("Disconnected");
    expect(status).toHaveAttribute("role", "alert");
  });

  it("truncates the subtitle instead of breaking the layout at narrow widths (spec 027 FR-009)", () => {
    render(<AppHeader health={null} {...themeProps} />);
    expect(screen.getByText("API test engineering workspace")).toHaveClass("truncate");
  });

  it("offers the command palette with its shortcut, without a dropdown on the status (AP-038 FR-006, FR-007)", () => {
    const onOpenCommandPalette = vi.fn();
    render(<AppHeader health={null} {...themeProps} onOpenCommandPalette={onOpenCommandPalette} />);
    const palette = screen.getByRole("button", { name: "Open command palette" });
    expect(palette).toHaveTextContent("Ctrl K");
    fireEvent.click(palette);
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("connection-status").querySelector("svg")).toBeNull();
  });

  it("opens the help dialog and returns focus to the help button when it closes (FR-021)", () => {
    render(<AppHeader health={null} {...themeProps} />);
    const help = screen.getByRole("button", { name: "Keyboard shortcuts and help" });
    help.focus();
    fireEvent.click(help);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts and workflows" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("help-dialog")).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });
});
