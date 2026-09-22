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

  it("re-selecting 'Guided Workflow' after 'Back to start' resumes it instead of silently handing off to Import & Run Collection again (regression)", async () => {
    const postmanArtifact = {
      collection: { info: { name: "c" }, item: [] },
      environment: { values: [] },
      readme: "readme text",
      summary: { requestCount: 0, folderCount: 0, byProvenance: { RULE: 0, AI: 0 } },
      limitations: [],
    };
    const stageIds = [
      "upload",
      "analysis",
      "apiReview",
      "deterministicGeneration",
      "aiEnhancement",
      "scenarioReview",
      "dependencyAnalysis",
      "workflowReview",
      "postmanGeneration",
      "execution",
    ] as const;
    const stages = Object.fromEntries(
      stageIds.map((id) => [
        id,
        { stageId: id, status: id === "execution" ? "active" : "complete" },
      ]),
    );
    const executionWorkflow = {
      id: "wf-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeStageId: "execution",
      stages,
      specificationFilename: "valid.yaml",
      apiModel: {
        operations: [],
        securitySchemes: {},
        summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
      },
      postmanArtifact,
    };

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
            status: 200,
            json: () => Promise.resolve({ workflow: executionWorkflow }),
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

    render(<App />);

    // Resuming directly onto the already-generated "execution" stage auto-hands-off once, as
    // intended (e.g. after a real page reload) — this is the FIRST handoff, not the regression.
    fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));
    expect(
      await screen.findByRole("navigation", { name: "Top-level views" }),
    ).toBeInTheDocument();

    // Switch back to the guided workflow's own tab to reach its "Back to start" control.
    fireEvent.click(screen.getByRole("button", { name: "Guided Workflow" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Exit the guided workflow and return to the start screen",
      }),
    );
    expect(await screen.findByTestId("entry-chooser")).toBeInTheDocument();

    // Re-selecting "Guided Workflow" must resume the guided workflow's own view, not silently
    // hand off to "Import & Run Collection" a second time.
    fireEvent.click(screen.getByRole("button", { name: "Guided Workflow" }));

    expect(await screen.findByTestId("execution-handoff-notice")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Top-level views" }),
    ).not.toBeInTheDocument();
  });
});
