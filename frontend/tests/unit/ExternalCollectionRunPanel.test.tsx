import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  CollectionRequestView,
  FailureAnalysis,
  FailureAnalysisInProgress,
  UploadedCollectionExecutionRun,
} from "@apipilot/shared-domain";
import type { UploadedCollectionSummary } from "../../src/services/externalCollectionsClient";
import {
  ExternalCollectionRunPanel,
  endpointPath,
  type RunOrderPlacement,
  type RunOrderReorder,
} from "../../src/components/ExternalCollectionRunPanel";

function requestView(overrides: Partial<CollectionRequestView> = {}): CollectionRequestView {
  return {
    id: "item-1",
    name: "Get widget",
    wasEdited: false,
    raw: { method: "GET", url: "https://example.test", headers: [] },
    resolved: { method: "GET", url: "https://example.test", headers: [] },
    unresolvedVariables: [],
    variableReferences: [],
    copiedScriptFolderIds: [],
    ...overrides,
  };
}

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

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByTestId("unverified-content-dialog")).toBeInTheDocument();

    // Declining dispatches no start request.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/execution/start"))).toBe(false);

    // Accepting proceeds and starts the run.
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(screen.queryByTestId("unverified-content-dialog")).not.toBeInTheDocument();
  });

  it("renders passed/failed/not-attempted rows with their labels, and each testOutcomes detail on expansion", async () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await screen.findByTestId("external-collection-run-summary");

    // US3/FR-010: an uploaded-collection run is always labeled "Uploaded" so it is never mistaken
    // for a generated run.
    expect(screen.getByTestId("external-collection-run-summary")).toHaveTextContent("Uploaded");
    expect(screen.getByText("Get widget")).toBeInTheDocument();
    expect(screen.getByText("Create widget")).toBeInTheDocument();
    expect(screen.getByText("Delete widget")).toBeInTheDocument();
    // "Passed" also appears as the overview stat's <dt> label, so assert at least one match rather than a unique one.
    expect(screen.getAllByText("Passed").length).toBeGreaterThan(0);
    // Sentence-case display labels, not the raw kebab-case enum values ("assertion-failed",
    // "cancelled").
    expect(screen.getByText("Assertion failed")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();

    // The failed test's own detail lives under the expanded row's "Tests" tab, not shown by default.
    fireEvent.click(screen.getByText("Create widget"));
    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    expect(await screen.findByText("expected 201, got 500")).toBeInTheDocument();
  });

  it("shows no run-order checklist when the collection view hasn't loaded (requests omitted)", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} />);
    expect(screen.queryByText("Run order")).not.toBeInTheDocument();
  });

  it("shows every request pre-selected, and starting a run sends every id", async () => {
    const calls = stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const requests = [requestView({ id: "item-1", name: "Get widget" }), requestView({ id: "item-2", name: "Create widget" })];
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} requests={requests} />);

    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/execution/start"))).toBe(true));
    const startCall = calls.find((call) => call.url.includes("/execution/start"));
    expect(JSON.parse(startCall!.init!.body as string)).toEqual({
      confirmed: false,
      selectedRequestIds: ["item-1", "item-2"],
    });
  });

  it("unchecking a request excludes it from the selection sent to the backend", async () => {
    const calls = stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const requests = [requestView({ id: "item-1", name: "Get widget" }), requestView({ id: "item-2", name: "Create widget" })];
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} requests={requests} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Create widget in this run" }));
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/execution/start"))).toBe(true));
    const startCall = calls.find((call) => call.url.includes("/execution/start"));
    expect(JSON.parse(startCall!.init!.body as string)).toEqual({
      confirmed: false,
      selectedRequestIds: ["item-1"],
    });
  });

  it("disables Start run once every request is unchecked, and Reset restores the full selection", async () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const requests = [requestView({ id: "item-1", name: "Get widget" })];
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} requests={requests} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Get widget in this run" }));
    expect(screen.getByText("0 of 1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).not.toBeDisabled();
  });
});

describe("ExternalCollectionRunPanel — the run-order list (FR-015)", () => {
  function placementsFor(ids: string[], folderPath: string[] = []): ReadonlyMap<string, RunOrderPlacement> {
    return new Map(ids.map((id, index) => [id, { containerId: "root", folderPath, index, siblingCount: ids.length }]));
  }

  function reorderFor(overrides: Partial<RunOrderReorder> = {}): RunOrderReorder {
    return { onMove: vi.fn(), locked: false, ...overrides };
  }

  const twoRequests = () => [requestView({ id: "item-1", name: "Get widget" }), requestView({ id: "item-2", name: "Create widget" })];

  it("moves a request up or down within its folder, disables moves past either end, and offers no Move to…", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const reorder = reorderFor();
    render(
      <ExternalCollectionRunPanel
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={twoRequests()}
        placements={placementsFor(["item-1", "item-2"])}
        reorder={reorder}
      />,
    );

    expect(screen.getByRole("button", { name: "Move Get widget up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Create widget down" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Get widget down" }));
    expect(reorder.onMove).toHaveBeenCalledWith("root", "item-1", "down");
    expect(screen.queryByRole("button", { name: /to another folder/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Move to…")).not.toBeInTheDocument();
  });

  it("shows each row's folder, method, name and endpoint path", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const requests = [
      requestView({
        id: "item-1",
        name: "Get order",
        raw: { method: "GET", url: "{{baseUrl}}/orders/{{orderId}}?expand=items", headers: [] },
      }),
      requestView({ id: "item-2", name: "Health", raw: { method: "POST", url: "https://api.example.test/health", headers: [] } }),
    ];
    const placements = new Map<string, RunOrderPlacement>([
      ["item-1", { containerId: "archive", folderPath: ["Orders", "Archive"], index: 0, siblingCount: 1 }],
      ["item-2", { containerId: "root", folderPath: [], index: 0, siblingCount: 1 }],
    ]);
    render(
      <ExternalCollectionRunPanel
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={requests}
        placements={placements}
      />,
    );

    const rows = screen.getAllByRole("checkbox").map((checkbox) => checkbox.closest("li"));
    expect(rows[0]).toHaveTextContent("1Orders / ArchiveGETGet order/orders/{{orderId}}");
    expect(rows[1]).toHaveTextContent("2POSTHealth/health");
  });

  it("derives the endpoint path from the raw URL, keeping {{variables}} and dropping host and query", () => {
    expect(endpointPath("{{baseUrl}}/orders/{{id}}?x=1")).toBe("/orders/{{id}}");
    expect(endpointPath("https://api.example.test/v1/health")).toBe("/v1/health");
    expect(endpointPath("https://api.example.test")).toBe("/");
    expect(endpointPath("orders")).toBe("/orders");
  });

  it("shows no move controls without reorder, and disables them while the collection is locked", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const { rerender } = render(
      <ExternalCollectionRunPanel
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={twoRequests()}
        placements={placementsFor(["item-1", "item-2"])}
      />,
    );
    expect(screen.queryByRole("button", { name: "Move Get widget down" })).not.toBeInTheDocument();

    rerender(
      <ExternalCollectionRunPanel
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={twoRequests()}
        placements={placementsFor(["item-1", "item-2"])}
        reorder={reorderFor({ locked: true })}
      />,
    );
    expect(screen.getByRole("button", { name: "Move Get widget down" })).toBeDisabled();
  });

  it("keeps an excluded request excluded when the order changes", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const { rerender } = render(
      <ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} requests={twoRequests()} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Create widget in this run" }));
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();

    rerender(
      <ExternalCollectionRunPanel
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={[...twoRequests()].reverse()}
      />,
    );
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Create widget in this run" })).not.toBeChecked();
  });
});

describe("ExternalCollectionRunPanel — AI failure analysis (AP-031)", () => {
  const storedAnalysis: FailureAnalysis = {
    analysisVersion: 2,
    runId: "run-1",
    resultIndex: 1,
    requestName: "Create widget",
    requestMethod: "POST",
    conclusion: {
      kind: "likely-cause",
      cause: "downstream-service-issue",
      strength: "moderate",
      ruleId: "dependency-named-in-server-error",
      decidingEvidenceIds: ["E1"],
    },
    classificationProvenance: { source: "RULE", ruleSetVersion: 1 },
    explanation: {
      status: "available",
      summary: "A dependency failed.",
      investigationSteps: ["Check the dependency."],
      citedEvidenceIds: ["E1"],
      provenance: { source: "AI", aiModel: "test-model", aiProvider: "local", responseVersion: 4 },
    },
    evidence: [{ id: "E1", kind: "response-status", source: "run-result", text: "Response status 500" }],
    specificationContext: { status: "unavailable", reason: "no-request-identity" },
    analyzedAt: "2026-09-24T10:00:00.000Z",
  };

  /** History with one run; its detail; its stored analyses; and a scripted in-progress sequence. */
  function stubAnalysisFetch(options: { analyses: () => FailureAnalysis[]; inProgress: () => FailureAnalysisInProgress | null }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: () => Promise.resolve(body) });
        if (url.endsWith("/failure-analysis/in-progress")) {
          const entry = options.inProgress();
          return entry ? json(200, { inProgress: entry }) : json(204, null);
        }
        if (url.endsWith("/failure-analyses")) return json(200, { analyses: options.analyses() });
        if (url.endsWith("/execution/runs")) return json(200, { runs: [{ ...completedRun(), results: undefined }] });
        if (url.endsWith("/execution/runs/run-1")) return json(200, { run: completedRun() });
        return json(200, {});
      }),
    );
  }

  async function openRun() {
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })} />);
    fireEvent.click(await screen.findByRole("button", { name: /1 passed · 1 failed/ }));
    await screen.findByTestId("external-collection-run-summary");
  }

  it("offers analysis only on failed results and shows a stored analysis on load", async () => {
    stubAnalysisFetch({ analyses: () => [storedAnalysis], inProgress: () => null });
    await openRun();

    fireEvent.click(screen.getByText("Get widget"));
    expect(screen.queryByTestId("failure-analysis-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Create widget"));
    expect(await screen.findByText("Potential downstream-service issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze again: Create widget" })).toBeEnabled();
  });

  it("keeps Analyze disabled while an analysis this tab did not start is in progress, then shows its result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let running = true;
    stubAnalysisFetch({
      analyses: () => (running ? [] : [storedAnalysis]),
      inProgress: () =>
        running
          ? { runId: "run-1", resultIndex: 1, requestName: "Create widget", phase: "generating", phaseStartedAt: new Date().toISOString() }
          : null,
    });
    try {
      await openRun();
      fireEvent.click(screen.getByText("Create widget"));

      expect(await screen.findByText("Generating")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Analyze failure: Create widget" })).toBeDisabled();

      running = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      expect(await screen.findByText("Potential downstream-service issue")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("button", { name: "Analyze again: Create widget" })).toBeEnabled());
    } finally {
      vi.useRealTimers();
    }
  });
});
