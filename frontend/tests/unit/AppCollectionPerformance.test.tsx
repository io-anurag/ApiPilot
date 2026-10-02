import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CollectionPlanRequest } from "../../src/pages/CollectionPerformancePage";

/**
 * AP-036 (research R20; tasks T031): the fifth tab, "Collection Performance Test", appears once a
 * collection's run panel hands its selection over. The two pages are replaced by stand-ins, so this
 * checks only App's wiring; each page has its own tests. Kept apart from App.test.tsx because the
 * module mocks apply to a whole file.
 */
vi.mock("../../src/pages/ExternalCollectionsPage", () => ({
  ExternalCollectionsPage: ({ onSetUpPerformanceTest }: { onSetUpPerformanceTest?: (collectionId: string, ids: string[]) => void }) => (
    <button type="button" onClick={() => onSetUpPerformanceTest?.("uc-1", ["item-2", "item-1"])}>
      Hand over the selection
    </button>
  ),
}));

vi.mock("../../src/pages/CollectionPerformancePage", () => ({
  CollectionPerformancePage: ({ request }: { request?: CollectionPlanRequest | null }) => (
    <p data-testid="collection-page-stand-in">
      {request ? `${request.collectionId}: ${request.orderedRequestIds.join(", ")} (#${request.nonce})` : "no request"}
    </p>
  ),
}));

const { App } = await import("../../src/App");

afterEach(() => vi.unstubAllGlobals());

describe("App with a collection performance test", () => {
  it("shows the fifth tab only after a hand-off, and passes the ordered selection to the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "ok", timestamp: "2026-10-02T12:00:00.000Z" }) })),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Import & Run Collection" }));
    expect(screen.queryByRole("button", { name: "Collection Performance Test" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Hand over the selection" }));
    expect(await screen.findByTestId("collection-page-stand-in")).toHaveTextContent("uc-1: item-2, item-1 (#1)");
    expect(screen.getByRole("button", { name: "Collection Performance Test" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import & Run Collection" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hand over the selection" }));
    expect(await screen.findByTestId("collection-page-stand-in")).toHaveTextContent("(#2)");
  });
});
