import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { CoveragePage } from "../../../src/pages/CoveragePage";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { fetchCoverage, type CoverageResult } from "../../../src/services/coverageClient";
import { metric, operation, requirement, snapshot, stateCounts } from "./coverageFixtures";

vi.mock("../../../src/services/coverageClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/coverageClient")>()),
  fetchCoverage: vi.fn(),
}));
const fetchMock = vi.mocked(fetchCoverage);
const ok = (data: CoverageSnapshot): CoverageResult => ({ ok: true, snapshot: data });

function renderPage(onOpenWorkflow = vi.fn()) {
  render(
    <ActiveViewContext.Provider value="coverage">
      <CoveragePage onOpenWorkflow={onOpenWorkflow} />
    </ActiveViewContext.Provider>,
  );
  return onOpenWorkflow;
}

beforeEach(() => {
  fetchMock.mockReset();
});

const evidenceNotice = snapshot().notices[0];

describe("CoveragePage: workflow states (use cases A, B, C, D, E, G)", () => {
  it("A: specification uploaded, no tests generated: real zeros, the missing coverage, and a link to scenario generation", async () => {
    const empty = snapshot({
      context: { workflowId: "wf", selectedOperationCount: 4, scenarioCounts: { total: 0, accepted: 0, pending: 0, rejected: 0, rule: 0, ai: 0 } },
      execution: { sources: [], runIds: [], availableRuns: [], evidenceMode: "latest-per-scenario", evidenceByRun: [], environments: [], excludedRuns: [], unattributedResults: 0, editedResults: 0 },
      metrics: [
        metric("spec-operations", "specification", "Operations", 0, 4),
        metric("runtime-operations", "runtime", "Operations with passing verification", 0, 4),
        metric("runtime-assertions", "runtime", "Assertions evaluated and passed", 0, 0),
      ],
      operations: [operation({ operationKey: "GET /orders", specification: { covered: 0, total: 4 }, runtime: { verified: 0, total: 4 }, stateCounts: stateCounts({ "not-covered": 4 }) })],
      notices: [evidenceNotice, { code: "no-scenarios", severity: "warning", message: "No tests have been generated for this specification, so nothing is covered yet." }],
    });
    fetchMock.mockResolvedValue(ok(empty));
    const onOpenWorkflow = renderPage();
    expect(await screen.findByText(/No tests have been generated/)).toBeInTheDocument();
    expect(screen.getAllByText("Not covered").length).toBeGreaterThan(0);
    const runtime = screen.getByTestId("runtime-metrics");
    expect(within(runtime).getByText("Last qualifying execution")).toBeInTheDocument();
    expect(within(runtime).getByText("None")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Go to scenario generation" })[0]);
    expect(onOpenWorkflow).toHaveBeenCalledWith("guided-workflow");
    expect(screen.queryByRole("combobox", { name: "Evaluate run" })).not.toBeInTheDocument();
  });

  it("B: tests generated, not executed: labels them generated, not executed", async () => {
    fetchMock.mockResolvedValue(
      ok(
        snapshot({
          requirements: [requirement("op:POST /orders", "operation", "generated-not-executed")],
          operations: [operation({ operationKey: "POST /orders", stateCounts: stateCounts({ "generated-not-executed": 3 }), runtime: { verified: 0, total: 3 } })],
          notices: [evidenceNotice, { code: "not-executed", severity: "info", message: "30 generated scenarios have not been executed, so no runtime verification exists yet." }],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/have not been executed/)).toBeInTheDocument();
    expect(screen.getAllByText("Generated, not executed").length).toBeGreaterThan(0);
  });

  it("C and D: partial execution keeps failures and unexecuted requirements apart, with a link to the failing result", async () => {
    fetchMock.mockResolvedValue(ok(snapshot()));
    const onOpenWorkflow = renderPage();
    const post = (await screen.findAllByTestId("gap-row")).find((r) => r.dataset.operation === "POST /orders") as HTMLElement;
    expect(post).toHaveTextContent("Executed, failed");
    expect(post).toHaveTextContent("Verified");
    const delRow = screen.getAllByTestId("gap-row").find((r) => r.dataset.operation === "DELETE /orders/{id}") as HTMLElement;
    expect(delRow).not.toHaveTextContent("Executed, failed");
    expect(delRow).toHaveTextContent("Generated, not executed");
    fireEvent.click(screen.getAllByRole("button", { name: "Open failing result" })[0]);
    expect(onOpenWorkflow).toHaveBeenCalledWith("import-collection");
  });

  it("E: explains results that no longer match any scenario, without counting them", async () => {
    fetchMock.mockResolvedValue(
      ok(
        snapshot({
          execution: { sources: ["uploaded"], runIds: [], availableRuns: [{ id: "run-1", kind: "uploaded", startedAt: "2026-10-10T09:00:00.000Z", label: "Orders collection" }], evidenceMode: "latest-per-scenario", evidenceByRun: [], environments: [], excludedRuns: [], unattributedResults: 214, editedResults: 0 },
          notices: [
            evidenceNotice,
            { code: "unattributed-results", severity: "warning", message: "214 execution results do not match any scenario of the current specification (possibly from an earlier specification) and are not counted as verified." },
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/possibly from an earlier specification/)).toBeInTheDocument();
  });

  it("G: shows a specification with malformed or unsupported constructs as not measurable, with reasons", async () => {
    fetchMock.mockResolvedValue(
      ok(
        snapshot({
          notMeasurable: [
            { kind: "construct", operationKey: "POST /orders", label: "unsupported-construct", location: "#/paths//orders/post", reason: "oneOf is not supported" },
            { kind: "construct", label: "circular-ref", reason: "Circular reference in #/components/schemas/Node" },
          ],
        }),
      ),
    );
    renderPage();
    const list = await screen.findByTestId("not-measurable");
    expect(list).toHaveTextContent("POST /orders · unsupported-construct: oneOf is not supported");
    expect(list).toHaveTextContent("Document · circular-ref: Circular reference");
  });

  it("G: makes no claim about security coverage and shows nothing it was not given", async () => {
    fetchMock.mockResolvedValue(ok(snapshot({ recommendations: [], gaps: [] })));
    renderPage();
    expect(await screen.findByTestId("recommendations-empty")).toBeInTheDocument();
    expect(screen.getByText(/Security and authorization:/).closest("p")).toHaveTextContent("unavailable");
    expect(screen.queryByText(/sample|demo|mock/i)).not.toBeInTheDocument();
  });
});
