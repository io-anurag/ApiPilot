import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { LiveRunDashboard } from "../../src/components/liveRun/LiveRunDashboard";
import { fetchLiveRun } from "../../src/services/liveRunClient";
import { liveSnapshot } from "./liveRunFixtures";

vi.mock("../../src/services/liveRunClient", () => ({ fetchLiveRun: vi.fn() }));

/** AP-045 T046: keyboard order, names and non-colour state cues of the live run dashboard. */

const fetchMock = vi.mocked(fetchLiveRun);
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

async function renderLive(state: "live" | "completed" | "cancelled" | "failed" = "live") {
  fetchMock.mockResolvedValue({ ok: true, snapshot: liveSnapshot({ state }) });
  const view = render(<LiveRunDashboard kind="chain" runId="run-1" />);
  await settle();
  return view;
}

describe("Live run dashboard accessibility", () => {
  it("is a named region, and its chart, tables and progress bar have accessible names", async () => {
    await renderLive();
    expect(screen.getByRole("region", { name: "Live run figures" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /requests per second/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Planned time elapsed" })).toBeInTheDocument();
    expect(within(screen.getByTestId("live-run-latest")).getByRole("table")).toHaveAccessibleName();
    expect(within(screen.getByTestId("live-run-chains")).getByRole("list")).toBeInTheDocument();
    expect(within(screen.getByTestId("live-run-chains")).getByRole("progressbar")).toHaveAccessibleName();
    expect(screen.getByRole("heading", { name: "Latest requests" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chains" })).toBeInTheDocument();
  });

  it("has a keyboard path that uses only native controls and no positive tabindex", async () => {
    const { container } = await renderLive();
    const focusable = Array.from(container.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex]"));
    expect(focusable.map((element) => element.tagName)).toEqual(["SUMMARY"]);
    expect(focusable.every((element) => !(Number(element.getAttribute("tabindex")) > 0))).toBe(true);
    expect(container.querySelector("[onclick], [role='button']")).toBeNull();
    // The summary is a native disclosure; it comes after the chart it describes and before the tables.
    const order = Array.from(container.querySelectorAll("svg[role='img'], summary, table")).map((element) => element.tagName.toLowerCase());
    expect(order.slice(0, 2)).toEqual(["svg", "summary"]);
  });

  it("keeps the chart's text alternative a keyboard-openable disclosure", async () => {
    await renderLive();
    const summary = screen.getByText("Values as a table");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it.each([
    ["live", "Live"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
    ["failed", "Failed"],
  ] as const)("names the %s state in words, not only a colour", async (state, label) => {
    await renderLive(state);
    expect(screen.getAllByTestId("status-badge")[0]).toHaveTextContent(label);
  });

  it("states a failure in words", async () => {
    await renderLive("failed");
    expect(screen.getByRole("alert")).toHaveTextContent("The run ended in error.");
  });

  it("gives every request outcome a word and a number and every series a text name", async () => {
    await renderLive();
    expect(screen.getByText("OK 200")).toBeInTheDocument();
    const legend = within(screen.getByTestId("live-run-legend"));
    expect(legend.getByText("Requests/s")).toBeInTheDocument();
    expect(legend.getByText("Failures/s")).toBeInTheDocument();
  });

  it("keeps wide content scrollable inside its own box instead of widening the page", async () => {
    const { container } = await renderLive();
    for (const table of Array.from(container.querySelectorAll("table"))) {
      expect(table.parentElement?.className).toMatch(/overflow-x-auto|overflow-auto/);
    }
    expect(screen.getByTestId("live-run-chart-svg").parentElement?.className).toContain("overflow-x-auto");
  });
});
