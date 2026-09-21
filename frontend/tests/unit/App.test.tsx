import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../../src/App";

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ status: "ok", timestamp: "2026-08-26T12:00:00.000Z" }),
        });
      }
      if (url.includes("/api/test-generation-workflow")) {
        return Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.resolve(null),
        });
      }
      if (url.includes("/api/external-collections")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ uploadedCollections: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }),
  );
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a connected status once the health check succeeds", async () => {
    stubFetch();

    render(<App />);

    expect(screen.getByText("ApiPilot")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("connection-status")).toHaveTextContent("Connected"),
    );
  });

  it("shows an unreachable status when the health check fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health"))
          return Promise.reject(new Error("network error"));
        return Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.resolve(null),
        });
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("connection-status")).toHaveTextContent("Disconnected"),
    );
  });

  it("shows the entry chooser first, with no tab menu, until a path is picked", async () => {
    stubFetch();

    render(<App />);

    expect(await screen.findByTestId("entry-chooser")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Top-level views" }),
    ).not.toBeInTheDocument();
  });

  it("picking Guided Workflow hides the tab menu and shows the upload prompt (FR-017)", async () => {
    stubFetch();

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));

    expect(
      await screen.findByLabelText("Upload OpenAPI specification"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Top-level views" }),
    ).not.toBeInTheDocument();
  });

  it("an 'Exit workflow' control returns to the entry chooser without discarding the workflow", async () => {
    stubFetch();

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));
    await screen.findByLabelText("Upload OpenAPI specification");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Exit the guided workflow and return to the start screen",
      }),
    );

    expect(await screen.findByTestId("entry-chooser")).toBeInTheDocument();
  });

  it("picking 'Import & Run Collection' shows the tab menu immediately, reachable with no prior OpenAPI upload (FR-011, research.md D9)", async () => {
    stubFetch();

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Import & Run Collection" }),
    );

    expect(await screen.findByText("Import a Postman collection")).toBeInTheDocument();
    expect(screen.getByTestId("external-collection-upload")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Top-level views" }),
    ).toBeInTheDocument();

    // Switching back preserves the guided workflow's own state rather than remounting it.
    screen.getByRole("button", { name: "Guided Workflow" }).click();
    expect(
      await screen.findByLabelText("Upload OpenAPI specification"),
    ).toBeInTheDocument();
  });
});
