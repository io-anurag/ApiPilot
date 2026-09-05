import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "../../src/App";

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "ok", timestamp: "2026-08-26T12:00:00.000Z" }),
        });
      }
      if (url.includes("/api/test-generation-workflow")) {
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
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
        if (url.includes("/api/health")) return Promise.reject(new Error("network error"));
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("connection-status")).toHaveTextContent("Disconnected"),
    );
  });

  it("renders the guided workflow's upload prompt once resumed state loads (FR-017)", async () => {
    stubFetch();

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );
  });
});
