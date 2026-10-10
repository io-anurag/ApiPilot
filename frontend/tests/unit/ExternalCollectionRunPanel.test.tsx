import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
} from "../../src/components/ExternalCollectionRunPanel";
import type { RunOrder } from "../../src/utils/runOrder";

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

/** AP-036 FR-001, FR-002 (tasks T031). */
describe("ExternalCollectionRunPanel — plans seeded from collections (AP-037 US5)", () => {
  it("lists the request-chain plans created from collections, and opens one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const plans =
          url === "/api/chain-plans"
            ? [
                { id: "c1", name: "From APIFoundry", chainCount: 2, stepCount: 6, dataSetCount: 0, seedSource: "collection", updatedAt: "2026-10-03T10:00:00.000Z" },
                { id: "s1", name: "From a specification", chainCount: 1, stepCount: 1, dataSetCount: 0, seedSource: "specification", updatedAt: "2026-10-03T10:00:00.000Z" },
              ]
            : [];
        return { ok: true, status: 200, json: () => Promise.resolve(url === "/api/chain-plans" ? { plans } : { runs: [] }) };
      }),
    );
    const onOpenChainPlan = vi.fn();
    render(<ExternalCollectionRunPanel uploadedCollection={uploadedCollection()} requests={[requestView({ id: "item-1", name: "Get widget" })]} onOpenChainPlan={onOpenChainPlan} />);
    const list = await screen.findByTestId("seeded-plans");
    expect(within(list).queryByText("From a specification")).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Open From APIFoundry" }));
    expect(onOpenChainPlan).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("button", { name: "Set up a performance test" })).not.toBeInTheDocument();
  });
});

describe("ExternalCollectionRunPanel — the run-order list (FR-015c)", () => {
  const threeRequests = () => [
    requestView({ id: "item-1", name: "Get token" }),
    requestView({ id: "item-2", name: "Get health" }),
    requestView({ id: "item-3", name: "Get version" }),
  ];

  const placementsFor = (): ReadonlyMap<string, RunOrderPlacement> =>
    new Map([
      ["item-1", { folderPath: ["Auth"] }],
      ["item-2", { folderPath: ["Meta"] }],
      ["item-3", { folderPath: ["Meta"] }],
    ]);

  /** Holds the per-run order the way ExternalCollectionsPage does. */
  function Harness({ requests = threeRequests() }: Readonly<{ requests?: CollectionRequestView[] }>) {
    const [runOrder, setRunOrder] = useState<RunOrder>(undefined);
    return (
      <ExternalCollectionRunPanel
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={requests}
        placements={placementsFor()}
        runOrder={runOrder}
        onRunOrderChange={setRunOrder}
      />
    );
  }

  function rowNames() {
    return screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"));
  }

  async function startedIds(calls: Array<{ url: string; init?: RequestInit }>, nth = 0) {
    await waitFor(() => expect(calls.filter((call) => call.url.includes("/execution/start")).length).toBeGreaterThan(nth));
    const startCall = calls.filter((call) => call.url.includes("/execution/start"))[nth];
    return JSON.parse(startCall.init!.body as string).selectedRequestIds;
  }

  it("moves a request across folders with ↑/↓, disables moves past either end, and offers no Move to…", async () => {
    const calls = stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Move Get token up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Get version down" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Get version up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Get version up" }));
    expect(rowNames()).toEqual([
      "Include Get version in this run",
      "Include Get token in this run",
      "Include Get health in this run",
    ]);
    expect(screen.getByText("Moved Get version to position 1 of 3.")).toBeInTheDocument();
    expect(screen.queryByText("Move to…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await startedIds(calls)).toEqual(["item-3", "item-1", "item-2"]);
  });

  it("moves a request by dragging it onto another row", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<Harness />);
    const rowOf = (name: string) => screen.getByRole("checkbox", { name: `Include ${name} in this run` }).closest("li")!;
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };

    fireEvent.dragStart(rowOf("Get token"), { dataTransfer });
    fireEvent.dragOver(rowOf("Get version"), { dataTransfer });
    fireEvent.drop(rowOf("Get version"), { dataTransfer });

    expect(rowNames()).toEqual([
      "Include Get health in this run",
      "Include Get version in this run",
      "Include Get token in this run",
    ]);
  });

  it("keeps the order for every later run, and Reset restores the collection's order and selection", async () => {
    const calls = stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Get token down" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Get version in this run" }));
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await startedIds(calls, 0)).toEqual(["item-2", "item-1"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start run" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await startedIds(calls, 1)).toEqual(["item-2", "item-1"]);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(rowNames()).toEqual([
      "Include Get token in this run",
      "Include Get health in this run",
      "Include Get version in this run",
    ]);
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("drops a deleted request from the order and places an added one last", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Move Get version up" }));

    rerender(<Harness requests={[threeRequests()[1], threeRequests()[2], requestView({ id: "item-4", name: "Get info" })]} />);
    expect(rowNames()).toEqual([
      "Include Get version in this run",
      "Include Get health in this run",
      "Include Get info in this run",
    ]);
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
      ["item-1", { folderPath: ["Orders", "Archive"] }],
      ["item-2", { folderPath: [] }],
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

  it("shows no move controls without onRunOrderChange", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    render(
      <ExternalCollectionRunPanel
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={threeRequests()}
        placements={placementsFor()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Move Get token down" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Get token in this run" }).closest("li")).not.toHaveAttribute(
      "draggable",
      "true",
    );
  });

  it("keeps an excluded request excluded when the order changes", () => {
    stubFetch([{ status: 200, body: { run: completedRun() } }]);
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Get health in this run" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Get health up" }));
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();

    rerender(<Harness requests={[...threeRequests()].reverse()} />);
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Get health in this run" })).not.toBeChecked();
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

describe("ExternalCollectionRunPanel views (AP-042)", () => {
  function stubRunFetch(runs: unknown[] = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/execution/runs")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ runs }) };
        }
        if (url.includes("/failure-analyses")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ analyses: [], inProgress: null }) };
        }
        return { ok: true, status: 200, json: () => Promise.resolve({ inProgress: null, plans: [] }) };
      }),
    );
  }

  it("run view shows the order and launch card, without results or history", async () => {
    stubRunFetch();
    render(
      <ExternalCollectionRunPanel
        view="run"
        uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
        requests={[requestView()]}
      />,
    );
    expect(screen.getByTestId("external-collection-launch-card")).toHaveTextContent("1 of 1 selected");
    expect(screen.getByLabelText(/Include Get widget in this run/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(screen.queryByText("Run history")).not.toBeInTheDocument();
  });

  describe("run view's setup card (like a plan's Run setup)", () => {
    const write = (id: string, name: string, method: string, url: string) =>
      requestView({
        id,
        name,
        raw: { method, url, headers: [] },
        resolved: { method, url, headers: [] },
      });

    it("states readiness, the target and the run's facts", () => {
      stubRunFetch();
      render(
        <ExternalCollectionRunPanel
          view="run"
          uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01", requestDelayMs: 250 })}
          requests={[requestView()]}
          runOrder={["item-1"]}
          onOpenChainPlan={vi.fn()}
        />,
      );
      const card = within(screen.getByTestId("external-collection-launch-card"));
      expect(card.getByRole("heading", { name: "Ready to run on My collection (local)" })).toBeInTheDocument();
      const facts = within(screen.getByTestId("run-launch-facts"));
      expect(facts.getByText("1 of 1 selected")).toBeInTheDocument();
      expect(facts.getByText("Custom order")).toBeInTheDocument();
      expect(facts.getByText("local")).toBeInTheDocument();
      expect(facts.getByText("250 ms")).toBeInTheDocument();
      expect(card.getByRole("button", { name: "Start run" })).toBeEnabled();
      expect(screen.getByTestId("run-hosts")).toHaveTextContent("example.test");
    });

    it("warns about the requests that change data, per method, and says when there are none", () => {
      stubRunFetch();
      render(
        <ExternalCollectionRunPanel
          view="run"
          uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
          requests={[
            requestView(),
            write("w1", "Create widget", "POST", "https://example.test/widgets"),
            write("w2", "Delete widget", "DELETE", "https://example.test/widgets/1"),
          ]}
        />,
      );
      const writes = within(screen.getByTestId("run-writes"));
      expect(writes.getByText(/2 requests change data on My collection/)).toBeInTheDocument();
      expect(writes.getByText("Creates")).toBeInTheDocument();
      expect(writes.getByText("Deletes")).toBeInTheDocument();

      // Deselecting both writes leaves a read-only run.
      fireEvent.click(screen.getByLabelText(/Include Create widget in this run/));
      fireEvent.click(screen.getByLabelText(/Include Delete widget in this run/));
      expect(screen.getByTestId("run-writes")).toHaveTextContent("The selected requests only read data");
    });

    it("lists unresolved variables and every distinct host", () => {
      stubRunFetch();
      render(
        <ExternalCollectionRunPanel
          view="run"
          uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
          requests={[
            requestView({ unresolvedVariables: ["token", "baseUrl"] }),
            write("w3", "Other host", "GET", "https://other.test:8443/x"),
            write("w4", "Variable host", "GET", "{{baseUrl}}/y"),
          ]}
        />,
      );
      expect(screen.getByTestId("run-unresolved")).toHaveTextContent("2 without a value: baseUrl, token");
      expect(screen.getByTestId("run-hosts")).toHaveTextContent("example.test");
      expect(screen.getByTestId("run-hosts")).toHaveTextContent("other.test:8443");
      expect(screen.getByTestId("run-hosts")).toHaveTextContent("{{baseUrl}}");
    });

    it("says plainly when nothing is selected, and blocks Start run", () => {
      stubRunFetch();
      render(
        <ExternalCollectionRunPanel
          view="run"
          uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
          requests={[requestView()]}
        />,
      );
      fireEvent.click(screen.getByLabelText(/Include Get widget in this run/));
      expect(screen.getByRole("heading", { name: "Not ready to run yet" })).toBeInTheDocument();
      expect(screen.getByTestId("run-blocked")).toHaveTextContent("No requests are selected. Tick at least one in Run order.");
      expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();
    });

    it("shows the confirmation right under Start run, before the facts, not at the end of the card", async () => {
      stubRunFetch();
      render(
        <ExternalCollectionRunPanel
          view="run"
          uploadedCollection={uploadedCollection()}
          requests={[requestView()]}
          onOpenChainPlan={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      const dialog = await screen.findByTestId("unverified-content-dialog");
      const start = screen.getByRole("button", { name: "Start run" });
      const facts = screen.getByTestId("run-launch-facts");
      const loadTest = screen.getByRole("region", { name: "Load test instead" });
      expect(start.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(dialog.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(dialog.compareDocumentPosition(loadTest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("notes an unverified collection, and offers load testing separately from running", () => {
      stubRunFetch();
      render(
        <ExternalCollectionRunPanel
          view="run"
          uploadedCollection={uploadedCollection()}
          requests={[requestView()]}
          onOpenChainPlan={vi.fn()}
        />,
      );
      expect(screen.getByText(/unverified, so you will be asked to confirm/)).toBeInTheDocument();
      const loadTest = within(screen.getByRole("region", { name: "Load test instead" }));
      expect(loadTest.getByText(/This does not run anything/)).toBeInTheDocument();
      expect(loadTest.getByRole("button", { name: "Create request-chain plan" })).toBeInTheDocument();
    });

    it("shows the last run in one line with a link to the results", async () => {
      stubRunFetch([{ ...completedRun(), results: undefined }]);
      const onViewResults = vi.fn();
      render(
        <ExternalCollectionRunPanel
          view="run"
          uploadedCollection={uploadedCollection({ confirmedAt: "2026-01-01" })}
          requests={[requestView()]}
          onViewResults={onViewResults}
        />,
      );
      const line = await screen.findByTestId("run-launch-last-run");
      expect(line).toHaveTextContent("Completed");
      fireEvent.click(within(line).getByRole("button", { name: "View results" }));
      expect(onViewResults).toHaveBeenCalledTimes(1);
    });
  });

  it("results view shows the run history and a Run again action, without the order or Start run", async () => {
    stubRunFetch([{ ...completedRun(), results: undefined }]);
    const onRunAgain = vi.fn();
    render(
      <ExternalCollectionRunPanel
        view="results"
        uploadedCollection={uploadedCollection()}
        requests={[requestView()]}
        onRunAgain={onRunAgain}
      />,
    );
    expect(await screen.findByText("Run history")).toBeInTheDocument();
    expect(screen.getByText(/Select a run from the history/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Include Get widget in this run/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRunAgain).toHaveBeenCalledTimes(1);
  });

  it("hidden view renders nothing but still reports whether the collection has runs", async () => {
    stubRunFetch([{ ...completedRun(), results: undefined }]);
    const onHasRunsChange = vi.fn();
    const { container } = render(
      <ExternalCollectionRunPanel
        view="hidden"
        uploadedCollection={uploadedCollection()}
        onHasRunsChange={onHasRunsChange}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(onHasRunsChange).toHaveBeenLastCalledWith(true));
  });
});

describe("ExternalCollectionRunPanel PDF report (AP-043)", () => {
  function stubReportFetch(report: { ok: boolean; status?: number; body?: unknown; disposition?: string }) {
    const run = completedRun();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push(url);
        if (url.endsWith("/report.pdf") || url.endsWith("/report.html")) {
          if (!report.ok) return { ok: false, status: report.status ?? 409, json: () => Promise.resolve(report.body) };
          return {
            ok: true,
            status: 200,
            blob: () => Promise.resolve(new Blob(["%PDF-1.3"], { type: "application/pdf" })),
            headers: new Headers({ "Content-Disposition": report.disposition ?? 'attachment; filename="apipilot-run-report-My-collection-run-1.pdf"' }),
          };
        }
        if (url.endsWith("/execution/runs")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ runs: [{ ...run, results: undefined }] }) };
        }
        if (url.endsWith(`/execution/runs/${run.id}`)) {
          return { ok: true, status: 200, json: () => Promise.resolve({ run }) };
        }
        return { ok: true, status: 200, json: () => Promise.resolve({ analyses: [], inProgress: null, plans: [] }) };
      }),
    );
    return { calls, run };
  }

  async function openResults() {
    render(<ExternalCollectionRunPanel view="results" uploadedCollection={uploadedCollection()} requests={[requestView()]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Completed/ }));
    return screen.findByRole("button", { name: "Download PDF report" });
  }

  it("offers the report only once a finished run is open, and downloads it as a file", async () => {
    const { calls, run } = stubReportFetch({ ok: true });
    const createObjectURL = vi.fn(() => "blob:report");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    render(<ExternalCollectionRunPanel view="results" uploadedCollection={uploadedCollection()} requests={[requestView()]} />);
    expect(screen.queryByRole("button", { name: "Download PDF report" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Completed/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF report" }));

    await waitFor(() => expect(clicked).toEqual(["apipilot-run-report-My-collection-run-1.pdf"]));
    expect(calls).toContain(`/api/external-collections/uc-1/execution/runs/${run.id}/report.pdf`);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("downloads the HTML report from its own button, naming the file the server suggests", async () => {
    const { calls, run } = stubReportFetch({ ok: true, disposition: 'attachment; filename="apipilot-run-report-My-collection-run-1.html"' });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:report"), revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    render(<ExternalCollectionRunPanel view="results" uploadedCollection={uploadedCollection()} requests={[requestView()]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Completed/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Download HTML report" }));

    await waitFor(() => expect(clicked).toEqual(["apipilot-run-report-My-collection-run-1.html"]));
    expect(calls).toContain(`/api/external-collections/uc-1/execution/runs/${run.id}/report.html`);
    expect(calls.some((url) => url.endsWith("/report.pdf"))).toBe(false);
    click.mockRestore();
  });

  it("shows the server's reason when the report cannot be made, instead of a broken file", async () => {
    stubReportFetch({ ok: false, status: 409, body: { error: "run_in_progress", message: "A report is available once the run has finished." } });
    fireEvent.click(await openResults());
    expect(await screen.findByTestId("run-report-error")).toHaveTextContent("A report is available once the run has finished.");
  });
});
