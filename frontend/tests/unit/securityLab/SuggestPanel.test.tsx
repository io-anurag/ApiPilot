import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { SuggestPanel } from "../../../src/components/securityLab/SuggestPanel";
import * as aiStatus from "../../../src/services/aiStatusClient";
import * as client from "../../../src/services/securityLabClient";
import { suggestReply } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  suggestScenarios: vi.fn(),
}));
vi.mock("../../../src/services/aiStatusClient", () => ({ fetchAiStatus: vi.fn() }));

const suggestScenarios = vi.mocked(client.suggestScenarios);
const fetchAiStatus = vi.mocked(aiStatus.fetchAiStatus);

const NAMES = { authentication: "Authentication" };
const onSuggested = vi.fn();

const READY = { ok: true as const, status: { state: "ready" as const, provider: "local" as const, reason: null } };
const UNAVAILABLE = { ok: true as const, status: { state: "unavailable" as const, provider: "local" as const, reason: "Model failed to load." } };
const UNREADABLE = { ok: false as const, message: "Request failed with status 500" };

function renderPanel({ specificationLoaded = true, view = "security" }: { specificationLoaded?: boolean; view?: string } = {}) {
  return render(
    <ActiveViewContext.Provider value={view}>
      <SuggestPanel specificationLoaded={specificationLoaded} categoryNames={NAMES} onSuggested={onSuggested} />
    </ActiveViewContext.Provider>,
  );
}

beforeEach(() => {
  suggestScenarios.mockReset();
  fetchAiStatus.mockReset();
  onSuggested.mockReset();
  fetchAiStatus.mockResolvedValue(READY);
});

describe("SuggestPanel (T153, FR-064, SC-015)", () => {
  it("offers the suggestion as optional, and says the model never approves or runs anything", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { level: 2, name: "Suggest scenarios with the local AI model (optional)" })).toBeInTheDocument();
    expect(screen.getByText(/The model never approves or runs anything/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest scenarios" })).toBeEnabled();
    expect(screen.queryByTestId("suggest-outcome")).not.toBeInTheDocument();
  });

  it("stores nothing and asks nothing until the button is pressed", async () => {
    renderPanel();
    await waitFor(() => expect(fetchAiStatus).toHaveBeenCalledTimes(1));
    expect(suggestScenarios).not.toHaveBeenCalled();
  });

  describe("when the control is unavailable", () => {
    it("is disabled with the readiness reason, tied to the control, when the model is unavailable, and asks nothing", async () => {
      fetchAiStatus.mockResolvedValue(UNAVAILABLE);
      renderPanel();
      const button = screen.getByRole("button", { name: "Suggest scenarios" });
      await waitFor(() => expect(button).toBeDisabled());
      expect(screen.getByTestId("suggest-blocked")).toHaveTextContent("The local AI model is unavailable: Model failed to load. Every other part of Security Lab still works.");
      expect(button).toHaveAccessibleDescription(/Model failed to load\./);
      fireEvent.click(button);
      expect(suggestScenarios).not.toHaveBeenCalled();
    });

    it("is disabled with the way to proceed when no specification is loaded", async () => {
      renderPanel({ specificationLoaded: false });
      const button = screen.getByRole("button", { name: "Suggest scenarios" });
      expect(button).toBeDisabled();
      expect(screen.getByTestId("suggest-blocked")).toHaveTextContent("No specification is loaded");
      expect(screen.getByTestId("suggest-blocked")).toHaveTextContent("Upload one in the Guided Workflow");
      expect(button).toHaveAccessibleDescription(/Upload one in the Guided Workflow/);
      fireEvent.click(button);
      expect(suggestScenarios).not.toHaveBeenCalled();
    });

    it("stays usable, and says the status is unknown, when the model's status cannot be read; the server decides", async () => {
      fetchAiStatus.mockResolvedValue(UNREADABLE);
      renderPanel();
      expect(await screen.findByTestId("suggest-status-unknown")).toHaveTextContent("The AI model's status could not be read.");
      expect(screen.getByRole("button", { name: "Suggest scenarios" })).toBeEnabled();
    });

    it("does not read the model's status while another destination is shown", async () => {
      renderPanel({ view: "home" });
      await Promise.resolve();
      expect(fetchAiStatus).not.toHaveBeenCalled();
    });
  });

  describe("a suggestion run", () => {
    it("shows the drafts that were stored, each suggestion that was not and why, and refreshes the list", async () => {
      suggestScenarios.mockResolvedValue({ ok: true, data: suggestReply() });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      const outcome = await screen.findByTestId("suggest-outcome");
      expect(within(outcome).getByRole("status")).toHaveTextContent("1 suggestion was stored as a draft; 1 was not stored.");
      expect(outcome).toHaveTextContent("Stored as drafts, marked as AI-suggested. Review them before approving; nothing runs until you approve a scenario and start a run.");
      expect(within(screen.getByTestId("suggest-accepted")).getByRole("listitem")).toHaveTextContent("Reject a request with no credentials (GET /orders, Authentication)");
      expect(within(screen.getByTestId("suggest-rejected")).getByRole("listitem")).toHaveTextContent("Call another host (GET /orders): url_in_content: a scenario cannot name a destination.");
      expect(outcome).toHaveTextContent("Suggested by the local model “mock-model”.");
      expect(suggestScenarios).toHaveBeenCalledWith();
      expect(onSuggested).toHaveBeenCalledTimes(1);
    });

    it("names a suggestion that had no usable title by its position, and an unknown category by its id", async () => {
      suggestScenarios.mockResolvedValue({
        ok: true,
        data: suggestReply({
          accepted: [{ id: "ss-ai-2", title: "Odd category", operationKey: "GET /orders", categoryId: "something-else" }],
          rejected: [{ index: 2, reason: "schema_violation: not an object.", violations: [] }],
        }),
      });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      expect(await screen.findByTestId("suggest-accepted")).toHaveTextContent("Odd category (GET /orders, something-else)");
      expect(screen.getByTestId("suggest-rejected")).toHaveTextContent("Suggestion 3: schema_violation: not an object.");
    });

    it("says so when the model made no suggestions, and does not refresh the list", async () => {
      suggestScenarios.mockResolvedValue({ ok: true, data: suggestReply({ accepted: [], rejected: [] }) });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      expect(await screen.findByTestId("suggest-outcome")).toHaveTextContent("The model made no suggestions.");
      expect(onSuggested).not.toHaveBeenCalled();
    });

    it("does not refresh the list when every suggestion was rejected", async () => {
      suggestScenarios.mockResolvedValue({ ok: true, data: suggestReply({ accepted: [] }) });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      expect(await screen.findByTestId("suggest-outcome")).toHaveTextContent("0 suggestions were stored as drafts; 1 was not stored.");
      expect(screen.queryByTestId("suggest-accepted")).not.toBeInTheDocument();
      expect(onSuggested).not.toHaveBeenCalled();
    });

    it("says how many suggestions were over the limit", async () => {
      suggestScenarios.mockResolvedValue({ ok: true, data: suggestReply({ ignored: 3 }) });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      expect(await screen.findByTestId("suggest-outcome")).toHaveTextContent("3 more suggestions were over the limit and not looked at.");
    });

    it("disables the button and announces that the model is working while it runs", async () => {
      let resolve!: (value: Awaited<ReturnType<typeof client.suggestScenarios>>) => void;
      suggestScenarios.mockReturnValue(new Promise((r) => (resolve = r)));
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      expect(await screen.findByRole("button", { name: "Asking the local model..." })).toBeDisabled();
      expect(screen.getByText(/nothing is sent outside this machine/)).toBeInTheDocument();
      resolve({ ok: true, data: suggestReply() });
      await waitFor(() => expect(screen.getByRole("button", { name: "Suggest scenarios" })).toBeEnabled());
    });
  });

  describe("a refused run", () => {
    it("shows the server's ai_unavailable reason as an error, not as an empty result, and stores nothing", async () => {
      suggestScenarios.mockResolvedValue({ ok: false, error: "ai_unavailable", message: "The local AI model is unavailable: Model failed to load.", status: 503, details: {} });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      const error = await screen.findByTestId("suggest-error");
      expect(error).toHaveTextContent("No scenarios were suggested");
      expect(error).toHaveTextContent("The local AI model is unavailable: Model failed to load.");
      expect(screen.queryByTestId("suggest-outcome")).not.toBeInTheDocument();
      expect(onSuggested).not.toHaveBeenCalled();
    });

    it("replaces an earlier result with the error, and an earlier error with a later result", async () => {
      suggestScenarios.mockResolvedValueOnce({ ok: true, data: suggestReply() });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      await screen.findByTestId("suggest-outcome");

      suggestScenarios.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      expect(await screen.findByTestId("suggest-error")).toHaveTextContent("The Security Lab service is unreachable.");
      expect(screen.queryByTestId("suggest-outcome")).not.toBeInTheDocument();

      suggestScenarios.mockResolvedValueOnce({ ok: true, data: suggestReply() });
      fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
      expect(await screen.findByTestId("suggest-outcome")).toBeInTheDocument();
      expect(screen.queryByTestId("suggest-error")).not.toBeInTheDocument();
    });
  });
});
