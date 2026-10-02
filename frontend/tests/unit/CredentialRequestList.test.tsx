import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CredentialRequestList } from "../../src/components/performance/collection/CredentialRequestList";
import { collectionPlanFixture } from "./performanceFixtures";

/** AP-036 FR-012, FR-027 (research R8; tasks T031). */

const labels: Record<string, string> = { "s-create": "Customers / Create customer", "s-read": "Customers / Get customer" };

describe("CredentialRequestList", () => {
  it("shows each request run once before the load, the values it provides and the steps that use them", () => {
    render(<CredentialRequestList requests={collectionPlanFixture().collection!.credentialRequests} busy={false} stepLabel={(id) => labels[id] ?? id} onExpectedStatuses={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Run once before the load" })).toBeInTheDocument();
    expect(screen.getByText("Auth / Get token")).toBeInTheDocument();
    expect(screen.getByText("access_token")).toBeInTheDocument();
    expect(screen.getByText(/used by 2 steps: Customers \/ Create customer, Customers \/ Get customer/)).toBeInTheDocument();
    expect(screen.getByText("client_secret")).toBeInTheDocument();
    expect(screen.getByText("from the collection's test")).toBeInTheDocument();
  });

  it("sets its expected statuses and removes it by item id", () => {
    const onExpectedStatuses = vi.fn();
    const onRemove = vi.fn();
    render(<CredentialRequestList requests={collectionPlanFixture().collection!.credentialRequests} busy={false} stepLabel={(id) => id} onExpectedStatuses={onExpectedStatuses} onRemove={onRemove} />);
    fireEvent.change(screen.getByLabelText("Add an expected status for Auth / Get token"), { target: { value: "201" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onExpectedStatuses).toHaveBeenCalledWith("s-token", ["200", "201"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Auth / Get token from the plan" }));
    expect(onRemove).toHaveBeenCalledWith("req-token");
  });

  it("says when the collection's tests assert no status", () => {
    const [request] = collectionPlanFixture().collection!.credentialRequests;
    render(<CredentialRequestList requests={[{ ...request, expectedStatuses: [] }]} busy={false} stepLabel={(id) => id} onExpectedStatuses={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("The collection's tests assert no status for this request. Set at least one.")).toBeInTheDocument();
  });

  it("renders nothing without credential requests", () => {
    const { container } = render(<CredentialRequestList requests={[]} busy={false} stepLabel={(id) => id} onExpectedStatuses={vi.fn()} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
