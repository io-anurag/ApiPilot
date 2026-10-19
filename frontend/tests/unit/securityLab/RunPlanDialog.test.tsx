import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunPlanDialog } from "../../../src/components/securityLab/RunPlanDialog";
import * as client from "../../../src/services/securityLabClient";
import { runPreview, runView } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  startRun: vi.fn(),
}));

const startRun = vi.mocked(client.startRun);

const REQUEST = { profileId: "profile-1", items: [{ id: "ss-1", version: 1 }] };
const DESTRUCTIVE = [
  { scenarioId: "ss-1", version: 1, title: "Reject a request with no credentials", operationKey: "GET /orders", categoryId: "authentication", plannedRequests: 1, destructive: false },
  { scenarioId: "ss-d1", version: 1, title: "Delete an order", operationKey: "DELETE /orders/{id}", categoryId: "authentication", plannedRequests: 2, destructive: true },
  { scenarioId: "ss-d2", version: 2, title: "Purge the archive", operationKey: "DELETE /archive", categoryId: "authentication", plannedRequests: 1, destructive: true },
];

function renderDialog(preview = runPreview(), request: Partial<typeof REQUEST> & { limits?: { maxRequests: number } } = {}) {
  const onStarted = vi.fn();
  const onPreviewAgain = vi.fn();
  const onClose = vi.fn();
  render(<RunPlanDialog preview={preview} request={{ ...REQUEST, ...request }} onStarted={onStarted} onPreviewAgain={onPreviewAgain} onClose={onClose} />);
  return { onStarted, onPreviewAgain, onClose };
}

const startButton = () => screen.getByRole("button", { name: /Start run|Starting/ });
const attest = () => fireEvent.click(screen.getByLabelText(/I am authorized to test this target/));
const typeTarget = (name = "Staging", url = "https://api.example.test") => {
  fireEvent.change(screen.getByLabelText("Type the target name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Type the base URL"), { target: { value: url } });
};

beforeEach(() => startRun.mockReset());

describe("RunPlanDialog (T106, FR-041 to FR-045)", () => {
  it("is an alert dialog named for what it does, with focus on Cancel", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Confirm this run");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("says plainly that real requests will be sent, using the server's statement", () => {
    renderDialog();
    expect(screen.getByTestId("run-statement")).toHaveTextContent("Real requests will be sent to this target.");
  });

  it("shows the preview summary exactly as returned", () => {
    renderDialog(
      runPreview({
        summary: { profileName: "Nightly", environmentName: "QA box", tier: "qa", baseUrl: "https://qa.example.test", tlsPolicy: "verify", plannedRequests: 7, cleanupRequests: 2, scenarioCount: 3, limits: { maxRequests: 50, maxConcurrency: 2, timeoutMs: 4000 }, permittedCategories: ["authentication", "input-validation"], destinations: [{ host: "qa.example.test", port: 8443 }] },
      }),
    );
    const summary = screen.getByTestId("run-summary");
    expect(summary).toHaveTextContent("Profile: Nightly");
    expect(summary).toHaveTextContent("Target: QA box");
    expect(summary).toHaveTextContent("Base URL: https://qa.example.test");
    expect(summary).toHaveTextContent("Certificate verification: verify");
    expect(summary).toHaveTextContent("Sent to: qa.example.test:8443");
    expect(summary).toHaveTextContent("Scenarios: 3");
    expect(summary).toHaveTextContent("Planned requests: 7 (including 2 for cleanup)");
    expect(summary).toHaveTextContent("Limits: at most 50 requests, 2 at once, 4000 ms per request");
    expect(summary).toHaveTextContent("Permitted categories: authentication, input-validation");
  });

  it("lists the scenarios the run will execute", () => {
    renderDialog(runPreview({ scenarios: DESTRUCTIVE }));
    const rows = screen.getAllByTestId("run-plan-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Delete an order")).toBeInTheDocument();
    expect(within(rows[1]).getByText("DELETE /orders/{id}")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Destructive")).toBeInTheDocument();
  });

  it("keeps Start disabled until the attestation is given, and says what is still needed", () => {
    renderDialog(runPreview({ summary: { tier: "local", environmentName: "Local", baseUrl: "http://127.0.0.1:3000" } }));
    expect(startButton()).toBeDisabled();
    expect(startButton()).toHaveAccessibleDescription("Confirm that you are authorized to test this target.");
    attest();
    expect(startButton()).toBeEnabled();
    expect(screen.queryByTestId("start-needed")).not.toBeInTheDocument();
  });

  it("asks for no typing for a local target", () => {
    renderDialog(runPreview({ summary: { tier: "local", environmentName: "Local", baseUrl: "http://127.0.0.1:3000" } }));
    expect(screen.queryByTestId("retype-target")).not.toBeInTheDocument();
  });

  it.each(["staging", "dev", "qa"])("requires the exact target name and base URL for a %s target", (tier) => {
    renderDialog(runPreview({ summary: { tier } }));
    attest();
    expect(screen.getByTestId("retype-target")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    expect(screen.getByTestId("start-needed")).toHaveTextContent("Type the exact target name.");
    expect(screen.getByTestId("start-needed")).toHaveTextContent("Type the exact base URL.");
    typeTarget();
    expect(startButton()).toBeEnabled();
  });

  it("compares the typed name and URL exactly, so a near match does not enable Start", () => {
    renderDialog();
    attest();
    typeTarget("staging", "https://api.example.test");
    expect(startButton()).toBeDisabled();
    typeTarget("Staging ", "https://api.example.test");
    expect(startButton()).toBeDisabled();
    typeTarget("Staging", "https://api.example.test/");
    expect(startButton()).toBeDisabled();
    expect(screen.getByTestId("start-needed")).toHaveTextContent("Type the exact base URL.");
    expect(screen.getByTestId("start-needed")).not.toHaveTextContent("Type the exact target name.");
    typeTarget("Staging", "https://api.example.test");
    expect(startButton()).toBeEnabled();
  });

  it("lists each destructive scenario by title and operation with its own checkbox, and needs every one ticked", () => {
    renderDialog(runPreview({ scenarios: DESTRUCTIVE }));
    attest();
    typeTarget();
    const group = screen.getByRole("group", { name: /Destructive scenarios: confirm each one/ });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(within(group).getByText(/Delete an order/)).toBeInTheDocument();
    expect(within(group).getByText("DELETE /orders/{id}")).toBeInTheDocument();
    expect(within(group).getByText("DELETE /archive")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    expect(screen.getByTestId("start-needed")).toHaveTextContent("Confirm each destructive scenario (2 not confirmed).");
    fireEvent.click(boxes[0]);
    expect(screen.getByTestId("start-needed")).toHaveTextContent("(1 not confirmed)");
    fireEvent.click(boxes[1]);
    expect(startButton()).toBeEnabled();
    fireEvent.click(boxes[0]);
    expect(startButton()).toBeDisabled();
  });

  it("never allows a plan with problems to start, and lists the problems", () => {
    renderDialog(runPreview({ problems: [{ code: "budget_exceeded", message: "The plan needs 120 requests but at most 100 are allowed.", required: 120, allowed: 100 }] }));
    attest();
    typeTarget();
    expect(startButton()).toBeDisabled();
    expect(screen.getByRole("list", { name: "Plan problems" })).toHaveTextContent("budget_exceeded: The plan needs 120 requests but at most 100 are allowed.");
    expect(screen.getByTestId("start-needed")).toHaveTextContent("The plan has problems.");
  });

  it("starts with the digest of the preview, the typed confirmation, the ticked destructive ids and the limits", async () => {
    startRun.mockResolvedValue({ ok: true, data: { run: runView({ id: "run-9" }) } });
    const preview = runPreview({ scenarios: DESTRUCTIVE });
    const { onStarted } = renderDialog(preview, { items: [{ id: "ss-1", version: 1 }], limits: { maxRequests: 20 } });
    attest();
    typeTarget();
    for (const box of within(screen.getByTestId("destructive-confirmations")).getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(startButton());
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(startRun).toHaveBeenCalledWith({
      profileId: "profile-1",
      items: [{ id: "ss-1", version: 1 }],
      limits: { maxRequests: 20 },
      planDigest: "d".repeat(64),
      confirmation: { targetName: "Staging", targetBaseUrl: "https://api.example.test", authorizationAttested: true, destructiveScenarioIds: ["ss-d1", "ss-d2"] },
    });
    expect(onStarted.mock.calls[0][0].id).toBe("run-9");
    expect(onStarted.mock.calls[0][1]).toEqual({ "ss-1": "Reject a request with no credentials", "ss-d1": "Delete an order", "ss-d2": "Purge the archive" });
  });

  it("sends the previewed names for a local target, which has nothing to type", async () => {
    startRun.mockResolvedValue({ ok: true, data: { run: runView() } });
    renderDialog(runPreview({ summary: { tier: "local", environmentName: "Local", baseUrl: "http://127.0.0.1:3000" } }));
    attest();
    fireEvent.click(startButton());
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(startRun.mock.calls[0][0].confirmation).toEqual({ targetName: "Local", targetBaseUrl: "http://127.0.0.1:3000", authorizationAttested: true, destructiveScenarioIds: [] });
  });

  it("tells the person to preview again when the plan changed, and offers to", async () => {
    startRun.mockResolvedValue({ ok: false, error: "plan_changed", message: "The plan changed since it was previewed (the profile, the target, a scenario or the limits). Preview it again and confirm the new plan.", status: 409, details: {} });
    const { onPreviewAgain, onStarted } = renderDialog();
    attest();
    typeTarget();
    fireEvent.click(startButton());
    const error = await screen.findByTestId("run-start-error");
    expect(error).toHaveTextContent("The plan changed since it was previewed");
    expect(error).toHaveTextContent("Preview the run again, check the new plan and confirm it. Nothing was sent.");
    fireEvent.click(within(error).getByRole("button", { name: "Preview again" }));
    expect(onPreviewAgain).toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("shows what a refused confirmation is missing", async () => {
    startRun.mockResolvedValue({ ok: false, error: "confirmation_required", message: "The run needs an explicit confirmation of the target before any request is sent.", status: 409, details: { missing: ["targetName"] } });
    renderDialog();
    attest();
    typeTarget();
    fireEvent.click(startButton());
    expect(await screen.findByRole("list", { name: "Missing confirmations" })).toHaveTextContent("The typed target name does not match.");
  });

  it("shows the problems of a refused plan and the busy execution slot", async () => {
    startRun.mockResolvedValueOnce({ ok: false, error: "run_plan_invalid", message: "The run cannot start.", status: 422, details: { problems: [{ code: "not_approved", message: "Not approved at version 2." }] } });
    renderDialog();
    attest();
    typeTarget();
    fireEvent.click(startButton());
    expect(await screen.findByRole("list", { name: "Plan problems from the server" })).toHaveTextContent("not_approved: Not approved at version 2.");

    startRun.mockResolvedValueOnce({ ok: false, error: "execution_in_progress", message: "Another execution is already in progress in this session.", status: 409, details: { runId: "run-0" } });
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByTestId("run-start-error")).toHaveTextContent("Another execution is already in progress in this session."));
  });

  it("cancels without sending anything, and Escape closes it", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("does not allow closing or a second start while a start is in flight", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.startRun>>) => void;
    startRun.mockReturnValue(new Promise((r) => (resolve = r)));
    const { onClose } = renderDialog();
    attest();
    typeTarget();
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(startRun).toHaveBeenCalledTimes(1);
    resolve({ ok: true, data: { run: runView() } });
  });
});
