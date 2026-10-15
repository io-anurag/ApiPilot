import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RecentFailure } from "@apipilot/shared-domain";
import { NOT_CAPTURED_NOTE, RecentFailuresList } from "../../src/components/liveRun/RecentFailuresList";

/** AP-049: the live dashboard's Recent failures section. */

function failure(overrides: Partial<RecentFailure> = {}): RecentFailure {
  return {
    second: 75,
    chain: "POST /api/v1/products — positive",
    method: "POST",
    path: "/api/v1/products",
    status: 400,
    response: { kind: "text", contentType: "application/json", text: '{"error":"name already exists"}', truncated: false },
    ...overrides,
  };
}

describe("RecentFailuresList", () => {
  it("is a table with the failed request's UTC time, step, method, path and status, and the newest response open", () => {
    render(<RecentFailuresList failures={[failure()]} startedAt="2026-10-12T13:35:10.000Z" />);
    const table = within(screen.getByTestId("live-run-failures")).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Time (UTC)", "Step", "Method", "Path", "Status", "Response"]);
    expect(within(table).getByText("13:36:25")).toBeInTheDocument();
    expect(within(table).getByText("POST /api/v1/products — positive")).toBeInTheDocument();
    expect(within(table).getByText("/api/v1/products")).toBeInTheDocument();
    expect(within(table).getByText("Failed 400")).toBeInTheDocument();
    expect(within(table).getByLabelText("Response body")).toHaveTextContent('"error": "name already exists"');
  });

  it("indents a JSON response", () => {
    render(<RecentFailuresList failures={[failure()]} />);
    expect(screen.getByLabelText("Response body").textContent).toBe(JSON.stringify({ error: "name already exists" }, null, 2));
  });

  it("opens only the newest response, and each row can be shown or hidden", () => {
    render(<RecentFailuresList failures={[failure(), failure({ second: 70, response: { kind: "text", contentType: "text/plain", text: "older body", truncated: false } })]} />);
    const [newest, older] = screen.getAllByRole("button");
    expect(newest).toHaveAccessibleName("Hide response");
    expect(newest).toHaveAttribute("aria-expanded", "true");
    expect(older).toHaveAccessibleName("Show response");
    expect(screen.queryByText("older body")).not.toBeInTheDocument();
    fireEvent.click(older);
    expect(screen.getByText("older body")).toBeInTheDocument();
    fireEvent.click(newest);
    expect(screen.queryByLabelText("Response body", { selector: "pre" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")[0]).toHaveAccessibleName("Show response");
  });

  it("says in words when the response was cut, empty, absent or withheld", () => {
    render(
      <RecentFailuresList
        failures={[
          failure({ response: { kind: "text", contentType: null, text: "partial", truncated: true } }),
          failure({ status: 500, response: { kind: "empty", contentType: "text/plain" } }),
          failure({ status: null, response: { kind: "none-received" } }),
          failure({ response: { kind: "withheld", reason: "secret-data-columns" } }),
        ]}
      />,
    );
    for (const button of screen.getAllByRole("button", { name: "Show response" })) fireEvent.click(button);
    expect(screen.getByText(/cut short/)).toBeInTheDocument();
    expect(screen.getByText(/The response had no body/)).toBeInTheDocument();
    expect(screen.getByText(/No response was received/)).toBeInTheDocument();
    expect(screen.getByText("No response")).toBeInTheDocument();
    expect(screen.getByText(/secret data set columns, and an error response could echo/)).toBeInTheDocument();
  });

  it("explains an empty list, and that it is a sample that is never saved", () => {
    render(<RecentFailuresList failures={[]} />);
    expect(screen.getByText("No failed requests have been sampled.")).toBeInTheDocument();
    expect(screen.getByText(/not every failure/)).toBeInTheDocument();
    expect(screen.getByText(/nothing here is saved/i)).toBeInTheDocument();
  });
});

/** AP-052: a Run k6 Script run lists the same columns, but ApiPilot cannot see a response. */
describe("RecentFailuresList for a Run k6 Script run", () => {
  const scriptFailure = (overrides: Partial<RecentFailure> = {}) =>
    failure({ chain: "Create order", method: "POST", path: "", status: 422, response: { kind: "not-captured", reason: "user-script" }, ...overrides });

  it("keeps the table's columns and says Not captured instead of offering a response", () => {
    render(<RecentFailuresList kind="user-script" failures={[scriptFailure(), scriptFailure({ second: 70, chain: "127.0.0.1:18089", method: "GET", path: "/bad", status: 500 })]} startedAt="2026-10-12T13:35:10.000Z" />);
    const table = within(screen.getByTestId("live-run-failures")).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Time (UTC)", "Step", "Method", "Path", "Status", "Response"]);
    expect(within(table).getByText("Create order")).toBeInTheDocument();
    expect(within(table).getByText("Failed 422")).toBeInTheDocument();
    expect(within(table).getByText("/bad")).toBeInTheDocument();
    expect(within(table).getAllByText("Not captured")).toHaveLength(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Response body")).not.toBeInTheDocument();
  });

  it("explains why there is no response, that it is a sample and that nothing is saved, even when the list is empty", () => {
    render(<RecentFailuresList kind="user-script" failures={[]} />);
    expect(screen.getByText("No failed requests have been sampled.")).toBeInTheDocument();
    expect(screen.getByText(/not every failure/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(NOT_CAPTURED_NOTE.slice(0, 40)))).toBeInTheDocument();
    expect(screen.getByText(/nothing here is saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/with the response each one got/)).not.toBeInTheDocument();
  });

  it("still offers the explanation for a request that got no response at all", () => {
    render(<RecentFailuresList kind="user-script" failures={[scriptFailure({ status: null, response: { kind: "none-received" } })]} />);
    expect(screen.getByText("No response")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide response" })).toBeInTheDocument();
    expect(screen.getByText(/No response was received/)).toBeInTheDocument();
  });

  it("leaves a request-chain run's text and responses as they were", () => {
    render(<RecentFailuresList failures={[]} />);
    expect(screen.getByText(/with the response each one got/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(NOT_CAPTURED_NOTE.slice(0, 40)))).not.toBeInTheDocument();
  });
});
