import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioEditor } from "../../../src/components/securityLab/ScenarioEditor";
import * as client from "../../../src/services/securityLabClient";
import { NO_FLAGS, scenarioDetail } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  editScenario: vi.fn(),
}));

const editScenario = vi.mocked(client.editScenario);

function renderEditor(detail = scenarioDetail()) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const onReload = vi.fn();
  render(<ScenarioEditor detail={detail} onSaved={onSaved} onCancel={onCancel} onReload={onReload} />);
  return { onSaved, onCancel, onReload };
}

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const effect = () => screen.getByTestId("edit-effect");

beforeEach(() => editScenario.mockReset());

describe("ScenarioEditor (T077, FR-030)", () => {
  it("opens on the stored content, with save disabled and the reason stated until something changes", () => {
    renderEditor();
    expect(screen.getByLabelText("Title")).toHaveValue("Reject a request with no credentials");
    expect((screen.getByLabelText("Request (base request, JSON)") as HTMLTextAreaElement).value).toContain('"Accept": "application/json"');
    expect(effect()).toHaveTextContent("No changes yet.");
    const save = screen.getByRole("button", { name: "Save as version 2" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Change at least one field to save.");
  });

  it("says before saving that a title edit is not material and that an approval carries over", () => {
    renderEditor(scenarioDetail({ scenario: { reviewState: "approved" } }));
    type("Title", "A clearer title");
    expect(effect()).toHaveTextContent("This edit is not material: it does not change the test.");
    expect(effect()).toHaveTextContent("The approval of version 1 carries over to version 2.");
    expect(effect()).toHaveTextContent("Changed: title.");
    expect(screen.getByRole("button", { name: "Save as version 2" })).toBeEnabled();
  });

  it("says before saving that an edit to the request is material and that approval will be withdrawn", () => {
    renderEditor(scenarioDetail({ scenario: { reviewState: "approved" } }));
    type("Request (base request, JSON)", '{"pathParameters":{},"queryParameters":{"page":2},"headers":{}}');
    expect(effect()).toHaveTextContent("This is a material edit: it changes the test itself.");
    expect(effect()).toHaveTextContent("The approval of version 1 will be withdrawn and the scenario goes back to review.");
    expect(effect()).toHaveTextContent("Changed: baseRequest.");
  });

  it.each([
    ["Expected behavior (JSON)", JSON.stringify({ kind: "rejected", statement: "Something else.", basis: "product-rule", ruleId: "r" })],
    ["Evaluation conditions (JSON list)", '[{"kind":"status.equals","code":403}]'],
  ])("treats an edit to %s as material", (label, value) => {
    renderEditor();
    type(label, value);
    expect(effect()).toHaveTextContent("This is a material edit");
    expect(effect()).toHaveTextContent("An approval does not carry over to a material edit. Version 2 needs its own approval.");
  });

  it("is not material when the JSON is rewritten with the same content", () => {
    renderEditor();
    type("Evaluation conditions (JSON list)", '[ { "codes": [401], "kind": "status.in-set" } ]');
    expect(effect()).toHaveTextContent("No changes yet.");
  });

  it("marks a JSON field that is not valid, explains it, and blocks saving", () => {
    renderEditor();
    type("Expected behavior (JSON)", "{not json");
    const field = screen.getByLabelText("Expected behavior (JSON)");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Expected behavior (JSON): This is not valid JSON.");
    type("Title", "Changed");
    const save = screen.getByRole("button", { name: "Save as version 2" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Fix the fields marked invalid before saving.");
  });

  it("blocks a material edit with no specification loaded, with the reason, but allows a non-material one", () => {
    renderEditor(scenarioDetail({ scenario: { flags: { ...NO_FLAGS, specificationNotLoaded: true } } }));
    type("Evaluation conditions (JSON list)", '[{"kind":"status.equals","code":403}]');
    const save = screen.getByRole("button", { name: "Save as version 2" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(/A material edit needs a loaded specification/);
    type("Evaluation conditions (JSON list)", '[{"kind":"status.in-set","codes":[401]}]');
    type("Title", "Retitled");
    expect(screen.getByRole("button", { name: "Save as version 2" })).toBeEnabled();
  });

  it("sends only the changed fields against the version it was opened on, with the trimmed note", async () => {
    const detail = scenarioDetail({ scenario: { currentVersion: 4 } });
    const saved = { scenarioId: detail.scenario.id, version: 5, material: false, reviewState: "draft" as const, scenario: detail };
    editScenario.mockResolvedValue({ ok: true, data: saved });
    const { onSaved } = renderEditor(detail);
    type("Title", "Retitled");
    type("Suggested severity", "low");
    type("Note for the history (optional)", "  Reworded  ");
    fireEvent.click(screen.getByRole("button", { name: "Save as version 5" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(editScenario).toHaveBeenCalledWith(detail.scenario.id, { expectedVersion: 4, changes: { title: "Retitled", suggestedSeverity: "low" }, note: "Reworded" });
  });

  it("surfaces every scenario_invalid violation by its pointer, says nothing was changed, and does not report a save", async () => {
    editScenario.mockResolvedValue({
      ok: false,
      error: "scenario_invalid",
      message: "The edited scenario is not valid. Nothing was changed.",
      status: 422,
      details: {
        violations: [
          { pointer: "/rationale", code: "url_in_content", message: "/rationale: a URL is not allowed." },
          { pointer: "/plannedRequestCount", code: "unbounded", message: "/plannedRequestCount: must be bounded." },
        ],
      },
    });
    const { onSaved } = renderEditor();
    type("Rationale", "Send it to http://evil.example");
    fireEvent.click(screen.getByRole("button", { name: "Save as version 2" }));
    const error = await screen.findByTestId("scenario-edit-error");
    expect(error).toHaveTextContent("The edit is not valid. Nothing was changed.");
    const items = within(within(error).getByRole("list", { name: "Violations" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["/rationale: /rationale: a URL is not allowed.", "/plannedRequestCount: /plannedRequestCount: must be bounded."]);
    expect(onSaved).not.toHaveBeenCalled();
    // The form keeps what was typed so it can be fixed.
    expect(screen.getByLabelText("Rationale")).toHaveValue("Send it to http://evil.example");
  });

  it("offers to reload the current version after a stale_version refusal", async () => {
    editScenario.mockResolvedValue({ ok: false, error: "stale_version", message: "The scenario is at version 2, not 1. Reload it and edit the current version.", status: 409, details: { currentVersion: 2 } });
    const { onReload } = renderEditor();
    type("Title", "Retitled");
    fireEvent.click(screen.getByRole("button", { name: "Save as version 2" }));
    const error = await screen.findByTestId("scenario-edit-error");
    expect(error).toHaveTextContent("The scenario is at version 2, not 1.");
    fireEvent.click(within(error).getByRole("button", { name: "Reload the current version" }));
    expect(onReload).toHaveBeenCalled();
  });

  it("shows the server's message for any other refusal", async () => {
    editScenario.mockResolvedValue({ ok: false, error: "no_specification", message: "No specification is loaded.", status: 409, details: {} });
    renderEditor();
    type("Title", "Retitled");
    fireEvent.click(screen.getByRole("button", { name: "Save as version 2" }));
    expect(await screen.findByTestId("scenario-edit-error")).toHaveTextContent("No specification is loaded.");
  });

  it("cancels without sending anything", () => {
    const { onCancel } = renderEditor();
    type("Title", "Retitled");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(editScenario).not.toHaveBeenCalled();
  });
});
