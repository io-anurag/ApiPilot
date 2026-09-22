import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ExternalCollectionsPage } from "../../src/pages/ExternalCollectionsPage";

afterEach(() => {
  vi.unstubAllGlobals();
});

function uploadedCollectionSummary(overrides: Partial<{ confirmedAt?: string }> = {}) {
  return {
    id: "uc-1",
    name: "My collection",
    tier: "local",
    requestDelayMs: 0,
    confirmedAt: "2026-01-01",
    createdAt: "2026-01-01",
    ...overrides,
  };
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

/** Routes every GET/mutation this page (and the panels it renders) issues to canned JSON. Extra
 * per-test routes (add/rename/delete) can be layered in via `extraRoutes`. */
function stubFetch(
  extraRoutes: Array<{ match: (url: string, init?: RequestInit) => boolean; response: unknown }> = [],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const extra = extraRoutes.find((route) => route.match(url, init));
      if (extra) return { ok: true, status: 200, json: () => Promise.resolve(extra.response) };
      if (url === "/api/external-collections") {
        return { ok: true, status: 200, json: () => Promise.resolve({ uploadedCollections: [uploadedCollectionSummary()] }) };
      }
      if (url.endsWith("/collection")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ collectionView: collectionView() }) };
      }
      if (url.endsWith("/execution/runs")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) };
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
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

  it("closes the request editor panel (deselecting the request) without hiding the tree", async () => {
    stubFetch();
    render(<ExternalCollectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));
    fireEvent.click(await findRequestRowButton("Get widget"));
    expect(await screen.findByLabelText("URL")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "✕ Close" }));
    expect(await screen.findByText(/Select a request from the collection/)).toBeInTheDocument();
    // The tree itself, and the run panel's checklist, stay visible — only the editor closed.
    expect(await findRequestRowButton("Get widget")).toBeInTheDocument();
    expect(screen.getByLabelText(/Include Get widget in this run/)).toBeInTheDocument();

    fireEvent.click(await findRequestRowButton("Get widget"));
    expect(await screen.findByLabelText("URL")).toBeInTheDocument();
  });

  it("closes the variable panel (returning to the empty-selection placeholder) via its own close button", async () => {
    stubFetch();
    render(<ExternalCollectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));
    await findRequestRowButton("Get widget");

    fireEvent.click(screen.getByRole("button", { name: "Variables" }));
    expect(await screen.findByTestId("variable-panel")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("variable-panel")).getByRole("button", { name: "✕ Close" }));
    expect(screen.queryByTestId("variable-panel")).not.toBeInTheDocument();
    expect(await screen.findByText(/Select a request from the collection/)).toBeInTheDocument();
  });

  it("adds a new request through an in-app dialog rather than window.prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    stubFetch([
      {
        match: (url, init) => url.endsWith("/items") && init?.method === "POST",
        response: {
          collectionView: { ...collectionView(), items: [...collectionView().items, requestView("item-3", "New request", "")] },
          newItemId: "item-3",
        },
      },
    ]);
    render(<ExternalCollectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));
    await findRequestRowButton("Get widget");

    fireEvent.click(screen.getByRole("button", { name: "+ Add request" }));
    const input = await screen.findByLabelText("New request name");
    fireEvent.change(input, { target: { value: "New request" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await findRequestRowButton("New request")).toBeInTheDocument();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("renames an item through an in-app dialog pre-filled with its current name", async () => {
    stubFetch([
      {
        match: (url, init) => url.endsWith("/items/item-1/rename") && init?.method === "PUT",
        response: { collectionView: { ...collectionView(), items: [requestView("item-1", "Renamed widget", "https://api.example.com/widgets"), requestView("item-2", "Get order", "{{baseUrl}}/orders")] } },
      },
    ]);
    render(<ExternalCollectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));
    await findRequestRowButton("Get widget");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Get widget" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(await screen.findByLabelText("New name")).toHaveValue("Get widget");
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "Renamed widget" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(await findRequestRowButton("Renamed widget")).toBeInTheDocument();
  });

  it("deletes an item through an in-app confirmation dialog rather than window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    stubFetch([
      {
        match: (url, init) => url.endsWith("/items/item-1") && init?.method === "DELETE",
        response: { collectionView: { ...collectionView(), items: [requestView("item-2", "Get order", "{{baseUrl}}/orders")] } },
      },
    ]);
    render(<ExternalCollectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));
    await findRequestRowButton("Get widget");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Get widget" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: /Delete \(1\)/ }));

    await waitFor(() => expect(screen.queryByText("Get widget")).not.toBeInTheDocument());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("does not re-show the unverified-content dialog on a second run after the first is confirmed", async () => {
    // `handleRunClick` shows the dialog purely from the client's own `confirmedAt` copy, before
    // any network call — so the very first "Start run" click never hits `/execution/start` at
    // all. Only "Confirm and run" does, already carrying `confirmed: true`, and succeeds outright
    // (this fixture's "local" tier has no destructive request to trigger the second gate).
    let startCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/external-collections") {
          // Never re-fetched by this page after the initial load — the fix must update the
          // already-loaded summary in place, not rely on a refetch to pick up `confirmedAt`.
          return { ok: true, status: 200, json: () => Promise.resolve({ uploadedCollections: [uploadedCollectionSummary({ confirmedAt: undefined })] }) };
        }
        if (url.endsWith("/collection")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ collectionView: collectionView() }) };
        }
        if (url.endsWith("/execution/runs")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) };
        }
        if (url.endsWith("/execution/start") && init?.method === "POST") {
          startCallCount += 1;
          return {
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                run: {
                  id: `run-${startCallCount}`,
                  source: "uploaded",
                  uploadedCollectionSetId: "uc-1",
                  uploadedCollectionSnapshot: { name: "My collection", tier: "local" },
                  status: "completed",
                  startedAt: "2026-01-01T00:00:00.000Z",
                  completedAt: "2026-01-01T00:00:01.000Z",
                  summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
                  results: [],
                  cancelRequested: false,
                },
              }),
          };
        }
        throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
      }),
    );

    render(<ExternalCollectionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByTestId("unverified-content-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));
    await screen.findByTestId("external-collection-run-summary");
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
    expect(startCallCount).toBe(1);

    // Regression: the page's own cached `uploadedCollections` list previously never learned about
    // the confirmation, so this second click re-showed the dialog (purely client-side, no request
    // sent) even though the backend had already recorded the confirmation permanently.
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(startCallCount).toBe(2));
  });

  it("still syncs the confirmation when the first run also needs the separate risk-tier gate (e.g. a destructive request)", async () => {
    // Regression: the backend records `confirmedAt` permanently the instant gate 1 sees
    // `confirmed: true` — *before* it even evaluates gate 2 (risk tier / destructive request). A
    // collection whose first-ever run also happens to need gate 2 (this fixture's destructive
    // POST) got that confirmation gate-1 response, but the page's `onConfirmed` sync was
    // previously wired only to the eventual *successful* run start, so it never fired here even
    // though the backend had already recorded the confirmation on the very first confirmed call.
    let startCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/external-collections") {
          return { ok: true, status: 200, json: () => Promise.resolve({ uploadedCollections: [uploadedCollectionSummary({ confirmedAt: undefined })] }) };
        }
        if (url.endsWith("/collection")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ collectionView: collectionView() }) };
        }
        if (url.endsWith("/execution/runs")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) };
        }
        if (url.endsWith("/execution/start") && init?.method === "POST") {
          startCallCount += 1;
          // Call 1 ("Confirm and run" on the unverified-content dialog): the backend has just
          // marked confirmedAt, but still blocks this same call on gate 2 since a destructive
          // request is present.
          if (startCallCount === 1) {
            return {
              ok: false,
              status: 409,
              json: () =>
                Promise.resolve({
                  error: "confirmation_required",
                  message: "This execution requires explicit confirmation before it can start.",
                  environmentTier: "local",
                  destructiveOperations: [{ operationMethod: "POST", operationPath: "/auth" }],
                }),
            };
          }
          // Call 2 ("Confirm and run" on the risk-tier banner) and any later call both succeed.
          return {
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                run: {
                  id: `run-${startCallCount}`,
                  source: "uploaded",
                  uploadedCollectionSetId: "uc-1",
                  uploadedCollectionSnapshot: { name: "My collection", tier: "local" },
                  status: "completed",
                  startedAt: "2026-01-01T00:00:00.000Z",
                  completedAt: "2026-01-01T00:00:01.000Z",
                  summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
                  results: [],
                  cancelRequested: false,
                },
              }),
          };
        }
        throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
      }),
    );

    render(<ExternalCollectionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /My collection/ }));

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByTestId("unverified-content-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));

    // Gate 1's confirmation cleared the unverified dialog; gate 2's own banner now appears instead.
    expect(await screen.findByTestId("risk-tier-confirmation-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));
    await screen.findByTestId("external-collection-run-summary");
    expect(startCallCount).toBe(2);

    // The real regression check: a third run click must skip the unverified-content dialog
    // entirely — it was already recorded on call 1, not call 2.
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(startCallCount).toBe(3));
  });
});
