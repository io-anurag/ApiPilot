import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { COVERAGE_STATES } from "@apipilot/shared-domain";
import { CoveragePage } from "../../../src/pages/CoveragePage";
import { StateBadge, PriorityBadge } from "../../../src/components/apiCoverage/CoverageBadges";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { STATE_LABELS } from "../../../src/components/apiCoverage/coverageViewModel";
import { fetchCoverage } from "../../../src/services/coverageClient";
import { snapshot } from "./coverageFixtures";

vi.mock("../../../src/services/coverageClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/coverageClient")>()),
  fetchCoverage: vi.fn(),
}));
const fetchMock = vi.mocked(fetchCoverage);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, snapshot: snapshot() });
});
afterEach(() => {
  delete document.documentElement.dataset.theme;
});

/**
 * What jsdom can verify about both themes (use case I): the view uses only theme tokens, never a
 * literal colour, and carries every status in text. Contrast and rendering themselves are checked
 * by eye in the quickstart's theme step; jsdom does not compute styles from the stylesheet.
 */
describe.each(["light", "dark"] as const)("CoveragePage in the %s theme", (theme) => {
  beforeEach(() => {
    document.documentElement.dataset.theme = theme;
  });

  async function renderLoaded(): Promise<HTMLElement> {
    render(
      <ActiveViewContext.Provider value="coverage">
        <CoveragePage onOpenWorkflow={() => undefined} />
      </ActiveViewContext.Provider>,
    );
    return screen.findByTestId("coverage-page");
  }

  it("uses theme tokens only: no literal colours in classes and no inline colour styles", async () => {
    const page = await renderLoaded();
    for (const el of [page, ...page.querySelectorAll<HTMLElement>("*")]) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/#[0-9a-fA-F]{3,8}|\[#|rgb\(|hsl\(/);
      const style = el.getAttribute("style") ?? "";
      expect(style).not.toMatch(/color|background|border|#|rgb|hsl/i);
    }
  });

  it("only sets inline width, for the proportional bars", async () => {
    const page = await renderLoaded();
    const styled = [...page.querySelectorAll<HTMLElement>("[style]")];
    expect(styled.length).toBeGreaterThan(0);
    for (const el of styled) expect(el.getAttribute("style")).toMatch(/^width:\s*[\d.]+%;?$/);
  });

  it("never carries a status by colour alone: every badge has a text label", async () => {
    const page = await renderLoaded();
    const badges = [...page.querySelectorAll("[data-testid='status-badge']")];
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) expect((badge.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("names every interactive control and keeps a visible focus indicator on buttons and links", async () => {
    const page = await renderLoaded();
    for (const control of page.querySelectorAll<HTMLElement>("button, a[href], select, input")) {
      const labelled = control.getAttribute("aria-label") || control.textContent?.trim() || control.closest("label")?.textContent?.trim();
      expect(labelled, control.outerHTML.slice(0, 80)).toBeTruthy();
    }
    for (const control of page.querySelectorAll<HTMLElement>("button, select, input")) {
      expect(control.className, control.outerHTML.slice(0, 80)).toMatch(/focus(-visible)?:/);
    }
  });

  it("gives the table a caption, scoped headers and a labelled region", async () => {
    await renderLoaded();
    const table = screen.getByTestId("gaps-table");
    expect(table.querySelector("caption")).not.toBeNull();
    for (const th of table.querySelectorAll("th")) expect(th.getAttribute("scope")).toBe("col");
    expect(screen.getByRole("search", { name: "Filter coverage gaps" })).toBeInTheDocument();
  });

  it("describes every chart in words", async () => {
    await renderLoaded();
    for (const chart of screen.getAllByRole("img")) expect(chart.getAttribute("aria-label")).toMatch(/\d/);
  });
});

describe("state and priority badges", () => {
  it("gives every coverage state its own readable label", () => {
    const labels = new Set<string>();
    for (const state of COVERAGE_STATES) {
      const { unmount } = render(<StateBadge state={state} />);
      const text = screen.getByTestId("status-badge").textContent ?? "";
      expect(text).toBe(STATE_LABELS[state]);
      labels.add(text);
      unmount();
    }
    expect(labels.size).toBe(COVERAGE_STATES.length);
  });

  it("separates failed, unexecuted, inconclusive and stale visually and in words", () => {
    const tones = new Map<string, string>();
    for (const state of ["executed-failed", "generated-not-executed", "inconclusive", "verified"] as const) {
      const { unmount } = render(<StateBadge state={state} />);
      tones.set(state, screen.getByTestId("status-badge").dataset.tone ?? "");
      unmount();
    }
    expect(new Set(tones.values()).size).toBe(4);
  });

  it("labels priority as a heuristic in its tooltip", () => {
    render(<PriorityBadge priority="high" />);
    expect(screen.getByText("High")).toHaveAttribute("title", expect.stringContaining("not a security assessment"));
  });
});
