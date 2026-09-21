import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExternalCollectionsPage } from "../../src/pages/ExternalCollectionsPage";

afterEach(() => {
  vi.unstubAllGlobals();
});

function uploadedCollectionSummary() {
  return { id: "uc-1", name: "My collection", tier: "local", requestDelayMs: 0, confirmedAt: "2026-01-01", createdAt: "2026-01-01" };
}

function requestView(id: string, name: string, url: string) {
  return {
    id,
    name,
    wasEdited: false,
    raw: { method: "GET", url, headers: [] },
    resolved: { method: "GET", url, headers: [] },
    unresolvedVariables: [],
  };
}

function collectionView() {
  return {
    id: "uc-1",
    items: [requestView("item-1", "Get widget", "https://api.example.com/widgets"), requestView("item-2", "Get order", "{{baseUrl}}/orders")],
    folders: [],
    variables: [],
  };
}

/** Routes every GET this page (and the panels it renders) issues to canned JSON. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/external-collections") {
        return { ok: true, status: 200, json: () => Promise.resolve({ uploadedCollections: [uploadedCollectionSummary()] }) };
      }
      if (url.endsWith("/collection")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ collectionView: collectionView() }) };
      }
      if (url.endsWith("/execution/runs")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

describe("ExternalCollectionsPage", () => {
  it("loads the newly selected request's own fields into the editor, not the previously selected request's", async () => {
    stubFetch();
    render(<ExternalCollectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));
    await waitFor(() => expect(screen.queryByText("Get widget")).toBeInTheDocument(), { timeout: 5000 });
    // Both the collection tree and the run panel's own "Run order" checklist list every request
    // by name — the tree's row is the only one that's a selection `<button>`, so target that
    // specifically rather than `findByText`, which would match both and throw on ambiguity.
    // The row's accessible name also includes its HttpMethodBadge text ("GET"), and a plain
    // substring regex would also match the row's own "Actions for Get widget" menu button — anchor
    // to the start so only the selection button (name starts with the method) matches.
    fireEvent.click(await screen.findByRole("button", { name: /^GET Get widget/ }));
    expect(await screen.findByLabelText("URL")).toHaveValue("https://api.example.com/widgets");

    fireEvent.click(await screen.findByRole("button", { name: /^GET Get order/ }));
    // Without a `key` tied to the selected request's id, RequestEditorPanel's own `useState`
    // initializer only ever runs once, and the URL input would still show "Get widget"'s value
    // here instead of loading "Get order"'s own `{{baseUrl}}/orders`.
    expect(await screen.findByLabelText("URL")).toHaveValue("{{baseUrl}}/orders");
  });
});
