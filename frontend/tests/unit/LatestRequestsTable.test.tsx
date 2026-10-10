import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LatestRequestsTable } from "../../src/components/liveRun/LatestRequestsTable";
import { recentRequest } from "./liveRunFixtures";

/** AP-045 T037: the latest-requests list. */

describe("LatestRequestsTable", () => {
  it("lists the requests in the order given, with the sample note", () => {
    render(
      <LatestRequestsTable
        requests={[recentRequest({ path: "/newest" }), recentRequest({ path: "/older", status: 500, failed: true }), recentRequest({ path: "/oldest", method: "POST", status: 201 })]}
      />,
    );
    expect(screen.getByText(/A sample of the most recent 15 completed requests, newest first, not every request\./)).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByText(/^\/(newest|older|oldest)$/).textContent)).toEqual(["/newest", "/older", "/oldest"]);
    expect(within(rows[2]).getByTestId("http-method-badge")).toHaveAttribute("data-method", "POST");
  });

  it("shows when each request finished, as time into the run, first in the row", () => {
    render(<LatestRequestsTable requests={[recentRequest({ second: 75 })]} />);
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("Time");
    expect(within(screen.getAllByRole("row")[1]!).getAllByRole("cell")[0]).toHaveTextContent("1:15");
  });

  it("shows the status as a word and a number", () => {
    render(<LatestRequestsTable requests={[recentRequest({ status: 200 }), recentRequest({ status: 503, failed: true }), recentRequest({ status: null, failed: true })]} />);
    expect(screen.getByText("OK 200")).toBeInTheDocument();
    expect(screen.getByText("Failed 503")).toBeInTheDocument();
    expect(screen.getByText("No response")).toBeInTheDocument();
  });

  it("shows a dash for an empty path and formats the duration", () => {
    render(<LatestRequestsTable requests={[recentRequest({ path: "", durationMs: 1500 }), recentRequest({ durationMs: 42 })]} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("—", { selector: "td" })).toBeInTheDocument();
    expect(within(rows[0]).getByText("1.50 s")).toBeInTheDocument();
    expect(within(rows[1]).getByText("42 ms")).toBeInTheDocument();
  });

  it("shows the step or request name, so a request with no path is still identified", () => {
    render(<LatestRequestsTable requests={[recentRequest({ chain: "List orders", path: "" })]} />);
    expect(screen.getByRole("columnheader", { name: "Step" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "List orders" })).toBeInTheDocument();
  });

  it("says so when no request has completed", () => {
    render(<LatestRequestsTable requests={[]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No requests have completed yet.")).toBeInTheDocument();
  });
});
