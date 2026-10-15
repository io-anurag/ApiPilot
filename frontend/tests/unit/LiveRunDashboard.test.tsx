import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LiveRunDashboard } from "../../src/components/liveRun/LiveRunDashboard";
import { fetchLiveRun, type LiveRunResult } from "../../src/services/liveRunClient";
import { collectionSnapshot, livePoint, liveSnapshot, recentRequest } from "./liveRunFixtures";

vi.mock("../../src/services/liveRunClient", () => ({ fetchLiveRun: vi.fn() }));

/** AP-045 T019, T021, T021a, T030: the live run dashboard's states and figures. */

const fetchMock = vi.mocked(fetchLiveRun);
const ok = (snapshot: ReturnType<typeof liveSnapshot>): LiveRunResult => ({ ok: true, snapshot });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function tile(label: string): HTMLElement {
  return screen.getByText(label, { selector: "dt" }).closest("[data-testid='stat-tile']") as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LiveRunDashboard for a Run k6 Script run", () => {
  it("shows the Recent failures section, with no response to open, when the snapshot carries failures", async () => {
    fetchMock.mockResolvedValue(
      ok(
        liveSnapshot({
          kind: "user-script",
          totals: { requests: 50, failures: 1 },
          recentFailures: [{ second: 2, chain: "127.0.0.1:18089", method: "GET", path: "/bad", status: 500, response: { kind: "not-captured", reason: "user-script" } }],
        }),
      ),
    );
    render(<LiveRunDashboard kind="user-script" runId="run-1" />);
    await settle();
    const section = screen.getByTestId("live-run-failures");
    expect(within(section).getByText("Failed 500")).toBeInTheDocument();
    expect(within(section).getByText("Not captured")).toBeInTheDocument();
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists each request name with its pass and fail bar, and offers Total and By request on the graph", async () => {
    fetchMock.mockResolvedValue(
      ok(
        liveSnapshot({
          kind: "user-script",
          plannedDurationMs: 8_000,
          elapsedMs: 4_000,
          chains: [
            { id: "List", label: "List items", requests: 10, failures: 0 },
            { id: "Create", label: "Create order", requests: 4, failures: 3 },
          ],
          series: {
            fromSecond: 0,
            bucketSeconds: 1,
            groups: [
              { id: "g1", label: "List items" },
              { id: "g2", label: "Create order" },
            ],
            points: [livePoint(0, { byGroup: { g1: 2, g2: 1 } }), livePoint(1, { byGroup: { g1: 3, g2: 1 } })],
          },
        }),
      ),
    );
    render(<LiveRunDashboard kind="user-script" runId="run-1" />);
    await settle();
    const section = screen.getByTestId("live-run-chains");
    expect(within(section).getByRole("heading", { name: "Requests" })).toBeInTheDocument();
    expect(within(section).getByText(/per request/)).toBeInTheDocument();
    expect(within(section).getByText("List items")).toBeInTheDocument();
    expect(within(section).getByRole("img", { name: "Create order: 1 passed, 3 failed" })).toBeInTheDocument();
    expect(within(section).getByText("10 req")).toBeInTheDocument();

    const toggle = screen.getByRole("group", { name: "Requests view" });
    expect(within(toggle).getByRole("button", { name: "Total" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(toggle).getByRole("button", { name: "By request" }));
    expect(within(toggle).getByRole("button", { name: "By request" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("live-run-legend")).getByText("Create order")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "By chain" })).not.toBeInTheDocument();
  });

  it("shows the planned-time progress bar when the run has a planned duration", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ kind: "user-script", plannedDurationMs: 8_000, elapsedMs: 4_000 })));
    render(<LiveRunDashboard kind="user-script" runId="run-1" />);
    await settle();
    expect(screen.getByRole("progressbar", { name: "Planned time elapsed" })).toHaveAttribute("value", "50");
    expect(within(tile("Elapsed")).getByText("of 00:08 planned")).toBeInTheDocument();
  });

  it("keeps a chain run's wording: Chains and By chain", async () => {
    fetchMock.mockResolvedValue(
      ok(
        liveSnapshot({
          series: { fromSecond: 0, bucketSeconds: 1, groups: [{ id: "a", label: "A" }, { id: "b", label: "B" }], points: [livePoint(0, { byGroup: { a: 1, b: 1 } })] },
        }),
      ),
    );
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    expect(within(screen.getByTestId("live-run-chains")).getByRole("heading", { name: "Chains" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By chain" })).toBeInTheDocument();
  });

  it("shows no section when the snapshot has no failure sample, as for a run no longer held", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ kind: "user-script" })));
    render(<LiveRunDashboard kind="user-script" runId="run-1" />);
    await settle();
    expect(screen.queryByTestId("live-run-failures")).not.toBeInTheDocument();
  });
});

describe("LiveRunDashboard", () => {
  it("shows skeletons and a status for assistive technology before the first reply", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    expect(screen.getByTestId("live-run-loading")).toHaveAccessibleName("");
    expect(screen.getByText("Loading live figures…")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("shows a live run's figures, chart, chain rows and latest requests", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot()));
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    expect(screen.getByRole("heading", { name: "Run in progress" })).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(within(tile("Requests done")).getByText("120")).toBeInTheDocument();
    expect(within(tile("Failures")).getByText("2")).toBeInTheDocument();
    expect(within(tile("Virtual users")).getByText("3")).toBeInTheDocument();
    expect(within(tile("Elapsed")).getByText("00:04")).toBeInTheDocument();
    expect(within(tile("Elapsed")).getByText("of 01:00 planned")).toBeInTheDocument();
    expect(within(tile("Average latency")).getByText("120 ms")).toBeInTheDocument();
    expect(within(tile("Average latency")).getByText("p95 latency 480 ms")).toBeInTheDocument();
    expect(within(tile("Failures")).getByText("1.7% of requests")).toBeInTheDocument();
    expect(within(tile("Virtual users")).getByText("peak 5")).toBeInTheDocument();
    expect(within(tile("Requests done")).getByText("10 req/s")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Planned time elapsed" })).toHaveAttribute("value", "7");
    expect(screen.getByRole("img", { name: /requests per second/i })).toBeInTheDocument();
    expect(within(screen.getByTestId("live-run-chains")).getByTestId("http-method-badge")).toHaveAttribute("data-method", "GET");
    expect(within(screen.getByTestId("live-run-latest")).getByText("/orders/{{id}}")).toBeInTheDocument();
  });

  it("shows a latency that is not known yet as 'No requests yet', never zero", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ latency: null, totals: { requests: 0, failures: 0 }, recent: [], series: { fromSecond: 0, bucketSeconds: 1, points: [] } })));
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    expect(within(tile("Average latency")).getByText("No requests yet")).toBeInTheDocument();
    expect(within(tile("Average latency")).queryByText(/^0/)).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the first figures")).toBeInTheDocument();
  });

  it("omits virtual users when the run has none", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ currentVirtualUsers: null })));
    render(<LiveRunDashboard kind="user-script" runId="run-1" />);
    await settle();
    expect(screen.queryByText("Virtual users", { selector: "dt" })).not.toBeInTheDocument();
  });

  it("shows a collection run as n of N with the request in flight and no duration or user figures", async () => {
    fetchMock.mockResolvedValue(ok(collectionSnapshot()));
    render(<LiveRunDashboard kind="collection" runId="run-1" collectionId="uc-1" />);
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("collection", { runId: "run-1", collectionId: "uc-1" }, { since: 0, bucket: undefined });
    const progress = screen.getByTestId("live-run-progress");
    expect(progress).toHaveTextContent("4 of 10 requests");
    expect(within(progress).getByRole("progressbar", { name: "Requests done" })).toHaveAttribute("max", "10");
    expect(screen.getByTestId("live-run-in-flight")).toHaveTextContent("Sending Get widget");
    expect(screen.queryByText("Average latency")).not.toBeInTheDocument();
    expect(screen.queryByText("p95 latency")).not.toBeInTheDocument();
    expect(screen.queryByText("Virtual users", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Step" })).toBeInTheDocument();
  });

  it("goes stale with the time of the last good reply, keeps the figures, and recovers", async () => {
    fetchMock.mockResolvedValueOnce(ok(liveSnapshot())).mockResolvedValue({ ok: false, error: "network_error", message: "down", retryable: true });
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    await tick(11_000);
    expect(screen.getByTestId("live-run-stale")).toHaveTextContent(/^Figures stale since \d\d:\d\d:\d\d UTC\./);
    expect(screen.getByText(/^Stale: no figures since \d\d:\d\d:\d\d UTC$/)).toBeInTheDocument();
    expect(within(tile("Requests done")).getByText("120")).toBeInTheDocument();
    fetchMock.mockResolvedValue(ok(liveSnapshot({ totals: { requests: 150, failures: 2 } })));
    await tick(1_000);
    expect(screen.queryByTestId("live-run-stale")).not.toBeInTheDocument();
    expect(within(tile("Requests done")).getByText("150")).toBeInTheDocument();
  });

  it("shows the final figures of a completed run and stops asking", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ state: "completed" })));
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByTestId("live-run-completed")).toHaveTextContent("final figures");
    await tick(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a cancelled run with the figures it reached", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ state: "cancelled" })));
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    expect(screen.getByText("Cancelled at 0:04")).toBeInTheDocument();
    expect(screen.getByTestId("live-run-cancelled")).toHaveTextContent("what it reached");
    expect(within(tile("Requests done")).getByText("120")).toBeInTheDocument();
  });

  it("shows a run that ended in error as an error and the figures it reached, never a blank panel", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ state: "failed" })));
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("The run ended in error.");
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(within(tile("Requests done")).getByText("120")).toBeInTheDocument();
    expect(screen.getByTestId("live-run-latest")).toBeInTheDocument();
  });

  it("shows an error when the very first reply is refused for good", async () => {
    fetchMock.mockResolvedValue({ ok: false, error: "run_not_found", message: "No such run", retryable: false });
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Live figures are unavailable.");
    expect(screen.getByRole("alert")).toHaveTextContent("No such run");
    expect(screen.queryByTestId("live-run-tiles")).not.toBeInTheDocument();
  });

  it("hands each snapshot to the host and shows a failed request with its status", async () => {
    const onSnapshot = vi.fn();
    const snapshot = liveSnapshot({ recent: [recentRequest({ status: null, failed: true })] });
    fetchMock.mockResolvedValue(ok(snapshot));
    render(<LiveRunDashboard kind="chain" runId="run-1" onSnapshot={onSnapshot} />);
    await settle();
    expect(onSnapshot).toHaveBeenCalled();
    expect(onSnapshot.mock.calls[0][0].runId).toBe("run-1");
    expect(screen.getByText("No response")).toBeInTheDocument();
  });

  it("reads only through liveRunClient and has no Cancel button", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    fetchMock.mockResolvedValue(ok(liveSnapshot()));
    render(<LiveRunDashboard kind="chain" runId="run-1" />);
    await settle();
    await tick(3_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });
});
