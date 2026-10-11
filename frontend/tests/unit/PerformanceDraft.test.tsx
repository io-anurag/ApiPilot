import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PerformancePage } from "../../src/pages/PerformancePage";
import { DraftBanner } from "../../src/components/performance/path/DraftBanner";
import { INITIAL_PATH_STATE, pathReducer } from "../../src/components/performance/path/pathState";
import { quickTestView, stubFetch } from "./performanceFixtures";
import { baseRoutes, PLAN, planSummary, QUICK, seededPlan } from "./performancePathFixtures";
import { viewOf } from "./requestChainFixtures";

/** AP-047 (specs/047-unified-performance-tab US5, FR-019 to FR-022): an unfinished test is kept, offered again and never lost silently. */

const current = () => screen.getAllByRole("listitem").find((item) => item.getAttribute("aria-current") === "step");
const next = () => screen.getByRole("button", { name: "Next →" });

function routes(extra: Parameters<typeof stubFetch>[0] = {}) {
  return baseRoutes({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }], "GET /api/chain-plans": () => [200, { plans: [planSummary] }], [`GET ${PLAN}`]: () => [200, viewOf(seededPlan())], ...extra });
}

/** Starts a test from the uploaded specification, leaves one operation out, and goes back to the entry screen. */
async function parkADraft() {
  fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
  const selection = await screen.findByTestId("operation-selection");
  fireEvent.click(within(selection).getByRole("checkbox", { name: "GET /customers" }));
  fireEvent.click(screen.getByRole("button", { name: "← Plans" }));
  return screen.findByTestId("draft-banner");
}

afterEach(() => vi.unstubAllGlobals());

describe("DraftBanner", () => {
  it("names the source and step in text, with Resume and Discard", () => {
    const draft = pathReducer(INITIAL_PATH_STATE, { type: "pick", source: "collection", specificationLoaded: false, selection: [] });
    const onResume = vi.fn();
    const onDiscard = vi.fn();
    render(<DraftBanner draft={draft} onResume={onResume} onDiscard={onDiscard} />);
    expect(screen.getByTestId("draft-banner")).toHaveTextContent("Draft in progress: a test from postman collection, at Requests (step 2 of 5).");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onResume).toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalled();
  });
});

describe("a parked draft", () => {
  it("is kept when the engineer goes back to the entry screen, and Resume brings back the step and the selection", async () => {
    stubFetch(routes());
    render(<PerformancePage />);
    const banner = await parkADraft();
    expect(banner).toHaveTextContent("a test from openapi specification, at Operations (step 2 of 5)");
    expect(screen.getByTestId("performance-home")).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: "Resume" }));
    expect(current()).toHaveTextContent("Operations");
    expect(within(await screen.findByTestId("operation-selection")).getByText("2 of 3 selected")).toBeInTheDocument();
    expect(within(screen.getByTestId("operation-selection")).getByRole("checkbox", { name: "GET /customers" })).not.toBeChecked();
  });

  it("is cleared by Discard", async () => {
    stubFetch(routes());
    render(<PerformancePage />);
    const banner = await parkADraft();
    fireEvent.click(within(banner).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByTestId("draft-banner")).not.toBeInTheDocument());
  });

  it("is reported to the page that holds the start screen, while it exists", async () => {
    stubFetch(routes());
    const onDraftChange = vi.fn();
    render(<PerformancePage onDraftChange={onDraftChange} />);
    await screen.findByRole("button", { name: /OpenAPI specification/ });
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
    const banner = await parkADraft();
    expect(onDraftChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(banner).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(false));
  });

  it("asks before a new source replaces it, and keeps it when the engineer cancels", async () => {
    stubFetch(routes());
    render(<PerformancePage />);
    await parkADraft();
    fireEvent.click(screen.getByRole("button", { name: /Postman collection/ }));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("A draft test is in progress. Starting a new one discards it.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("draft-banner")).toBeInTheDocument();
    expect(screen.getByTestId("performance-home")).toBeInTheDocument();
  });

  it("is replaced by the new source once the engineer confirms", async () => {
    stubFetch(routes());
    render(<PerformancePage />);
    await parkADraft();
    fireEvent.click(screen.getByRole("button", { name: /Postman collection/ }));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Discard the draft/ }));
    await waitFor(() => expect(current()).toHaveTextContent("Requests"));
    expect(screen.queryByTestId("draft-banner")).not.toBeInTheDocument();
  });

  it("asks before opening a saved plan too, because that would replace it", async () => {
    stubFetch(routes());
    render(<PerformancePage />);
    await parkADraft();
    fireEvent.click(await screen.findByRole("button", { name: "Open Quick Performance Fixture" }));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("Opening a plan discards it.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("draft-banner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Quick Performance Fixture" }));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Discard the draft/ }));
    await screen.findByLabelText("Plan name");
    expect(current()).toHaveTextContent("Plan");
  });
});

describe("leaving a path that has a plan (FR-022)", () => {
  it("saves the plan and keeps no draft", async () => {
    stubFetch(
      routes({
        "POST /api/chain-plans/seed": () => [201, { ...viewOf(seededPlan()), movedCredentials: [] }],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
    await screen.findByTestId("operation-selection");
    fireEvent.click(next());
    await screen.findByLabelText("Plan name");
    fireEvent.click(screen.getByRole("button", { name: "← Plans" }));
    await screen.findByRole("table", { name: "Saved performance plans" });
    expect(screen.queryByTestId("draft-banner")).not.toBeInTheDocument();
  });
});
