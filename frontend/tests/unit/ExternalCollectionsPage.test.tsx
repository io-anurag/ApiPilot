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

/**
 * Finds the collection tree's own selection button for a request by its exact name — distinct
 * from that same request's "Actions for <name>" menu button and its "Run order" checklist row
 * (neither is a selection control). `getByRole`'s `name` filter computes the accessible name via
 * the W3C accname algorithm, which does not behave like plain `textContent` concatenation here
 * (`HttpMethodBadge` and the name `<span>` have no literal space between them in the JSX), so this
 * matches on `textContent` directly instead of guessing the exact computed-name string.
 */
async function findRequestRowButton(name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const match = screen.getAllByRole("button").find((el) => el.textContent === `GET${name}`);
    if (!match) throw new Error(`No request row button found for "${name}" yet`);
    return match;
  });
}

describe("ExternalCollectionsPage", () => {
  it("loads the newly selected request's own fields into the editor, not the previously selected request's", async () => {
    stubFetch();
    render(<ExternalCollectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));
    fireEvent.click(await findRequestRowButton("Get widget"));
    expect(await screen.findByLabelText("URL")).toHaveValue("https://api.example.com/widgets");

    fireEvent.click(await findRequestRowButton("Get order"));
    // Without a `key` tied to the selected request's id, RequestEditorPanel's own `useState`
    // initializer only ever runs once, and the URL input would still show "Get widget"'s value here
    // instead of loading "Get order"'s own `{{baseUrl}}/orders`.
    expect(await screen.findByLabelText("URL")).toHaveValue("{{baseUrl}}/orders");
  });
});
