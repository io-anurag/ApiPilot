import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UploadedCollectionSummary } from "../../src/services/externalCollectionsClient";
import { ExternalCollectionList } from "../../src/components/ExternalCollectionList";

afterEach(() => {
  vi.unstubAllGlobals();
});

function collection(overrides: Partial<UploadedCollectionSummary> = {}): UploadedCollectionSummary {
  return { id: "uc-1", name: "My collection", tier: "local", requestDelayMs: 0, createdAt: "2026-01-01", ...overrides };
}

describe("ExternalCollectionList", () => {
  it("shows an empty state when there are no uploaded collections", () => {
    render(<ExternalCollectionList uploadedCollections={[]} selectedId={undefined} onSelect={vi.fn()} onRemoved={vi.fn()} />);
    expect(screen.getByText("No uploaded collections yet.")).toBeInTheDocument();
  });

  it("lists each collection's name and tier, and labels an unconfirmed one", () => {
    render(
      <ExternalCollectionList
        uploadedCollections={[collection(), collection({ id: "uc-2", name: "Confirmed", confirmedAt: "2026-01-01" })]}
        selectedId={undefined}
        onSelect={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByText("My collection")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("selects a collection on click", () => {
    const onSelect = vi.fn();
    render(<ExternalCollectionList uploadedCollections={[collection()]} selectedId={undefined} onSelect={onSelect} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByText("My collection"));
    expect(onSelect).toHaveBeenCalledWith("uc-1");
  });

  it("removes a collection and reports it removed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 204, json: () => Promise.resolve(null) })));
    const onRemoved = vi.fn();
    render(<ExternalCollectionList uploadedCollections={[collection()]} selectedId={undefined} onSelect={vi.fn()} onRemoved={onRemoved} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("uc-1"));
    expect(fetch).toHaveBeenCalledWith("/api/external-collections/uc-1", expect.objectContaining({ method: "DELETE" }));
  });
});
