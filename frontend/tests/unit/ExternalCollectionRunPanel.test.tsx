import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UploadedCollectionExecutionRun } from "@apipilot/shared-domain";
import type { UploadedCollectionSummary } from "../../src/services/externalCollectionsClient";
import { ExternalCollectionRunPanel } from "../../src/components/ExternalCollectionRunPanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

function uploadedCollection(overrides: Partial<UploadedCollectionSummary> = {}): UploadedCollectionSummary {
  return {
    id: "uc-1",
    name: "My collection",
    tier: "local",
    requestDelayMs: 0,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function completedRun(overrides: Partial<UploadedCollectionExecutionRun> = {}): UploadedCollectionExecutionRun {
  return {
    id: "run-1",
    source: "uploaded",
    uploadedCollectionSetId: "uc-1",
    uploadedCollectionSnapshot: { name: "My collection", tier: "local" },
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    summary: { total: 3, passed: 1, failed: 1, notAttempted: 1, durationMs: 30 },
    results: [
      {
        requestName: "Get widget",
        requestMethod: "GET",
        outcome: "passed",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 10,
        responseStatusCode: 200,
        testOutcomes: [{ name: "Status code is 200", outcome: "passed" }],
      },
      {
        requestName: "Create widget",
        requestMethod: "POST",
        outcome: "failed",
        failureCategory: "assertion-failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 15,
        responseStatusCode: 500,
        testOutcomes: [{ name: "Status code is 201", outcome: "failed", detail: "expected 201, got 500" }],
      },
      {
        requestName: "Delete widget",
        requestMethod: "DELETE",
        outcome: "not-attempted",
        notAttemptedReason: "cancelled",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 0,
        testOutcomes: [],
      },
    ],
    cancelRequested: false,
    ...overrides,
  };
}

/** Routes fetch calls: GET .../execution/runs (history) to an empty list, POST .../execution/start from `startResponses` in order. */
function stubFetch(startResponses: Array<{ status: number; body: unknown }>) {
  let startCallIndex = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (init?.method === "POST" && url.includes("/execution/start")) {
        const response = startResponses[startCallIndex] ?? startResponses[startResponses.length - 1];
        startCallIndex += 1;
        return { ok: response.status < 400, status: response.status, json: () => Promise.resolve(response.body) };
      }
      if (url.includes("/execution/runs")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) };
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) };
    }),
  );
  return calls;
}

describe("ExternalCollectionRunPanel", () => {
  it("requires the unverified-content confirmation before the first run of an unconfirmed collection (FR-007)", async () => {
    const calls = stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection()} />);

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByTestId("unverified-content-dialog")).toBeInTheDocument();

    // Declining dispatches no start request.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/execution/start"))).toBe(false);

    // Accepting proceeds and starts the run.
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and run" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/execution/start"))).toBe(true),
    );
    const startCall = calls.find((call) => call.url.includes("/execution/start"));
    expect(JSON.parse(startCall!.init!.body as string)).toEqual({ confirmed: true });
  });

  it("does not show the unverified-content dialog once a collection is already confirmed", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
  });

  it("renders passed/failed/not-attempted rows with their labels, and each testOutcomes detail on expansion", async () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("external-collection-run-summary");

    // US3/FR-010: an uploaded-collection run is always labeled "Uploaded" so it is never mistaken
    // for a generated run (the two never appear in the same panel — see ExecutionResultsPanel's
    // own "Generated" label assertion).
    expect(screen.getByTestId("external-collection-run-summary")).toHaveTextContent("Uploaded");
    expect(screen.getByText("Get widget")).toBeInTheDocument();
    expect(screen.getByText("Create widget")).toBeInTheDocument();
    expect(screen.getByText("Delete widget")).toBeInTheDocument();
    // "Passed" also appears as the overview stat's <dt> label, so assert at least one match rather than a unique one.
    expect(screen.getAllByText("Passed").length).toBeGreaterThan(0);
    expect(screen.getByText("assertion-failed")).toBeInTheDocument();
    expect(screen.getByText("cancelled")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Create widget"));
    expect(await screen.findByText("expected 201, got 500")).toBeInTheDocument();
  });
});
