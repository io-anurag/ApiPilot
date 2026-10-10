import { describe, expect, it } from "vitest";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import type { LiveSeries } from "@apipilot/shared-domain";
import { LiveRunChart } from "../../src/components/liveRun/LiveRunChart";
import { axisTicks, formatAxisTime, formatTick, timeSpan, timeTicks } from "../../src/components/liveRun/chartScale";
import { livePoint } from "./liveRunFixtures";

/** AP-045 T029, T031, T048: the run graphs (requests, failures, virtual users, response time). */

function series(points: ReturnType<typeof livePoint>[], bucketSeconds = 1, groups?: LiveSeries["groups"]): LiveSeries {
  return { fromSecond: points[0]?.second ?? 0, bucketSeconds, points, ...(groups ? { groups } : {}) };
}

const rateSvg = () => screen.getByTestId("live-run-chart-svg");
const pathOf = (id: string) => rateSvg().querySelector(`[data-series="${id}"]`)?.getAttribute("d") ?? "";
const texts = (selector: string) => [...rateSvg().querySelectorAll(selector)].map((node) => node.textContent);

async function openTable() {
  fireEvent.click(screen.getByText("Values as a table"));
  return screen.findByRole("table");
}

describe("LiveRunChart", () => {
  it("says it is waiting for the first figures instead of drawing an empty axis", () => {
    render(<LiveRunChart series={series([])} thinned={false} />);
    expect(screen.getByText("Waiting for the first figures")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("describes the latest figures in words", () => {
    render(<LiveRunChart series={series([livePoint(0), livePoint(1, { requests: 12, failures: 1, virtualUsers: 8 })])} thinned={false} />);
    const label = rateSvg().getAttribute("aria-label") ?? "";
    expect(label).toContain("12 requests per second");
    expect(label).toContain("1 failures per second");
    expect(label).toContain("8 virtual users");
  });

  it("extends with new points and keeps the earlier ones", () => {
    const { rerender } = render(<LiveRunChart series={series([livePoint(0), livePoint(1)])} thinned={false} />);
    expect(pathOf("requests").match(/[ML]/g)).toHaveLength(2);
    rerender(<LiveRunChart series={series([livePoint(0), livePoint(1), livePoint(2), livePoint(3)])} thinned={false} />);
    expect(pathOf("requests").match(/[ML]/g)).toHaveLength(4);
  });

  it("has a labelled axis on each side with tick values and a gridline at each of them", () => {
    render(<LiveRunChart series={series([livePoint(0, { requests: 18, virtualUsers: 6 }), livePoint(1, { requests: 18, virtualUsers: 6 })])} thinned={false} />);
    expect(texts('[data-axis-title="left"]')).toEqual(["Requests per second"]);
    expect(texts('[data-axis-title="right"]')).toEqual(["Virtual users"]);
    expect(texts('[data-axis="left"]')).toEqual(["0", "5", "10", "15", "20"]);
    expect(texts('[data-axis="right"]')).toEqual(["0", "2", "4", "6", "8"]);
    expect(rateSvg().querySelectorAll("[data-gridline]")).toHaveLength(5);
    expect(texts('[data-axis="time"]').length).toBeGreaterThan(1);
  });

  it("has no right axis when the run has no virtual users", () => {
    render(<LiveRunChart series={series([livePoint(0, { virtualUsers: null }), livePoint(1, { virtualUsers: null })])} thinned={false} />);
    expect(rateSvg().querySelector('[data-axis="right"]')).toBeNull();
    expect(rateSvg().querySelector('[data-series="virtual-users"]')).toBeNull();
    expect(screen.queryByText("Virtual users")).not.toBeInTheDocument();
    expect(rateSvg().getAttribute("aria-label")).not.toContain("virtual users");
  });

  it("spans the planned run on the time axis, not only the part drawn so far", () => {
    render(<LiveRunChart series={series([livePoint(0), livePoint(1)])} thinned={false} plannedSeconds={60} />);
    expect(texts('[data-axis="time"]').at(-1)).toBe("1:00");
  });

  it("names every line in a legend with its own line style, so colour is never the only cue", () => {
    render(<LiveRunChart series={series([livePoint(0), livePoint(1)])} thinned={false} />);
    const legend = within(screen.getByTestId("live-run-legend"));
    for (const name of ["Requests/s", "Failures/s", "Virtual users"]) expect(legend.getByText(name)).toBeInTheDocument();
    const dashes = ["requests", "failures", "virtual-users"].map((id) => rateSvg().querySelector(`[data-series="${id}"]`)?.getAttribute("stroke-dasharray") ?? "solid");
    expect(new Set(dashes).size).toBe(3);
  });

  it("plots requests divided by the bucket width", () => {
    render(<LiveRunChart series={series([livePoint(0, { requests: 20 }), livePoint(2, { requests: 20 })], 2)} thinned />);
    expect(rateSvg().getAttribute("aria-label")).toContain("10 requests per second");
  });

  it("reads off the second under the pointer, and the latest second otherwise", () => {
    render(<LiveRunChart series={series([livePoint(0, { requests: 4, latencyMs: 30 }), livePoint(1, { requests: 9, failures: 2, virtualUsers: 7, latencyMs: 55 })])} thinned={false} />);
    const readout = screen.getByTestId("live-run-readout");
    expect(readout).toHaveTextContent("At 0:01 · 9 requests/s · 2 failures/s · 7 virtual users · 55 ms average response time");
    const hit = screen.getByTestId("live-run-chart-svg-hit");
    hit.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    // jsdom has no PointerEvent, so the coordinate is set on the event itself.
    const move = createEvent.pointerMove(hit);
    Object.defineProperty(move, "clientX", { value: 0 });
    fireEvent(hit, move);
    expect(readout).toHaveTextContent("At 0:00 · 4 requests/s");
    expect(rateSvg().querySelector("[data-hover]")).not.toBeNull();
    fireEvent.pointerLeave(hit);
    expect(readout).toHaveTextContent("At 0:01");
  });

  it("draws the average response time as its own graph with a labelled axis, only when there is one", () => {
    const { rerender } = render(<LiveRunChart series={series([livePoint(0), livePoint(1)])} thinned={false} />);
    expect(screen.queryByTestId("live-run-latency-svg")).not.toBeInTheDocument();
    rerender(<LiveRunChart series={series([livePoint(0, { latencyMs: 80 }), livePoint(1, { latencyMs: null }), livePoint(2, { latencyMs: 40 })])} thinned={false} />);
    const latency = screen.getByTestId("live-run-latency-svg");
    expect(within(latency as unknown as HTMLElement).getByText("Average response time (ms)")).toBeInTheDocument();
    expect([...latency.querySelectorAll('[data-axis="left"]')].map((node) => node.textContent)).toEqual(["0", "20", "40", "60", "80"]);
    // A second with no completed request is a gap in the line, not a zero.
    expect(latency.querySelector('[data-series="latency"]')?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
  });

  it("breaks requests down by chain on request, one line per chain, and says so in the legend", () => {
    const groups = [{ id: "c1", label: "Orders" }, { id: "c2", label: "Health" }];
    const points = [livePoint(0, { requests: 10, byGroup: { c1: 7, c2: 3 } }), livePoint(1, { requests: 10, byGroup: { c1: 2, c2: 8 } })];
    render(<LiveRunChart series={series(points, 1, groups)} thinned={false} />);
    expect(pathOf("group-c1")).toBe("");
    expect(pathOf("requests")).not.toBe("");
    const total = screen.getByRole("button", { name: "Total" });
    const byChain = screen.getByRole("button", { name: "By chain" });
    expect(total).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(byChain);
    expect(byChain).toHaveAttribute("aria-pressed", "true");
    expect(pathOf("requests")).toBe("");
    expect(pathOf("group-c1").match(/[ML]/g)).toHaveLength(2);
    expect(pathOf("group-c2").match(/[ML]/g)).toHaveLength(2);
    const legend = within(screen.getByTestId("live-run-legend"));
    expect(legend.getByText("Orders")).toBeInTheDocument();
    expect(legend.getByText("Health")).toBeInTheDocument();
    expect(screen.getByTestId("live-run-readout")).toHaveTextContent("Orders 2/s · Health 8/s");
  });

  it("offers no chain view for a run without groups", () => {
    render(<LiveRunChart series={series([livePoint(0), livePoint(1)])} thinned={false} />);
    expect(screen.queryByRole("button", { name: "By chain" })).not.toBeInTheDocument();
  });

  it("offers a table whose rows match the points", async () => {
    const points = [livePoint(0, { requests: 3, failures: 1 }), livePoint(1, { requests: 7, failures: 0, virtualUsers: 6 })];
    render(<LiveRunChart series={series(points)} thinned={false} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const table = await openTable();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["3", "1", "3", "1", "5"]);
    expect(within(rows[1]!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["7", "0", "7", "0", "6"]);
  });

  it("notes when older seconds were merged, and not otherwise", () => {
    const { rerender } = render(<LiveRunChart series={series([livePoint(0)], 2)} thinned />);
    expect(screen.getByTestId("live-run-thinned")).toHaveTextContent("totals are unchanged");
    rerender(<LiveRunChart series={series([livePoint(0)])} thinned={false} />);
    expect(screen.queryByTestId("live-run-thinned")).not.toBeInTheDocument();
  });

  it("renders 1,800 points", () => {
    const points = Array.from({ length: 1800 }, (_, second) => livePoint(second, { requests: second % 50, virtualUsers: second % 20, latencyMs: 20 + (second % 30) }));
    const started = performance.now();
    render(<LiveRunChart series={series(points)} thinned={false} />);
    expect(pathOf("requests").match(/[ML]/g)).toHaveLength(1800);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe("chartScale", () => {
  it("gives five equal ticks up to a round maximum, so two axes line up", () => {
    expect(axisTicks(18)).toEqual([0, 5, 10, 15, 20]);
    expect(axisTicks(6)).toEqual([0, 2, 4, 6, 8]);
    expect(axisTicks(0, { integer: true })).toEqual([0, 1, 2, 3, 4]);
    expect(axisTicks(3, { integer: true })).toEqual([0, 1, 2, 3, 4]);
    expect(axisTicks(0.6)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(axisTicks(95)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks(1234)[4]).toBeGreaterThanOrEqual(1234);
  });

  it("puts time ticks on round seconds and at most eight of them", () => {
    expect(timeTicks(33)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(timeTicks(60)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(timeTicks(1_800).length).toBeLessThanOrEqual(8);
    expect(timeTicks(0)).toEqual([0, 1]);
  });

  it("formats times and ticks", () => {
    expect(formatAxisTime(75)).toBe("1:15");
    expect(formatAxisTime(3_725)).toBe("1:02:05");
    expect(formatTick(12)).toBe("12");
    expect(formatTick(2_500)).toBe("2.5k");
    expect(formatTick(12_000)).toBe("12k");
  });

  it("spans the planned run, and never less than what has been drawn", () => {
    expect(timeSpan(10, 1, 60)).toBe(60);
    expect(timeSpan(90, 1, 60)).toBe(91);
    expect(timeSpan(10, 1, null)).toBe(11);
  });
});
