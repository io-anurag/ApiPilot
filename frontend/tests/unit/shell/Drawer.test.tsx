import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AppShell } from "../../../src/components/shell/AppShell";

function renderShell() {
  const onNavigate = vi.fn();
  render(
    <AppShell
      route={{ view: "home" }}
      workflow={null}
      viewedStage={null}
      notice={null}
      health={null}
      theme="light"
      onThemeChange={() => undefined}
      onOpenCommandPalette={() => undefined}
      shortcutHint="Ctrl K"
      onNavigate={onNavigate}
    >
      <p>page</p>
    </AppShell>,
  );
  return { onNavigate, menu: screen.getByRole("button", { name: "Open navigation" }) };
}

const sidebar = () => screen.getByTestId("sidebar");

describe("navigation drawer (AP-054 FR-022)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is closed to begin with, and the menu button says so and what it controls", () => {
    const { menu } = renderShell();
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveAttribute("aria-controls", sidebar().id);
    expect(screen.queryByTestId("drawer-scrim")).not.toBeInTheDocument();
    expect(sidebar().className).toContain("invisible");
  });

  it("opens from the menu button, moves focus inside and traps Tab", () => {
    const { menu } = renderShell();
    menu.focus();
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("drawer-scrim")).toBeInTheDocument();
    expect(sidebar().className).not.toContain("invisible");
    expect(sidebar()).toContainElement(document.activeElement as HTMLElement);

    const focusable = sidebar().querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it("closes on Escape and returns focus to the menu button", () => {
    const { menu } = renderShell();
    menu.focus();
    fireEvent.click(menu);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("drawer-scrim")).not.toBeInTheDocument();
    expect(menu).toHaveFocus();
  });

  it("closes when the dimmed layer is chosen, with focus back on the menu button", () => {
    const { menu } = renderShell();
    menu.focus();
    fireEvent.click(menu);
    fireEvent.click(screen.getByTestId("drawer-scrim"));
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });

  it("closes when a destination is chosen, and navigates", () => {
    const { menu, onNavigate } = renderShell();
    menu.focus();
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("link", { name: "Coverage" }));
    expect(onNavigate).toHaveBeenCalledWith({ view: "coverage" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("closes if the window is widened past the drawer breakpoint, and never reads matchMedia", () => {
    const matchMedia = vi.fn();
    vi.stubGlobal("matchMedia", matchMedia);
    const { menu } = renderShell();
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    // jsdom's window is 1024 px wide, the `lg` breakpoint.
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(matchMedia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
