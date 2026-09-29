import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BodyEditInput, StepBodyEditModel } from "@apipilot/shared-domain";
import { LITERAL_VALUES_NOTE, StepBodyEditor } from "../../src/components/performance/StepBodyEditor";
import type { PerformanceErrorResult } from "../../src/services/performanceTestingClient";

/** AP-033 US2 (specs/033-edit-step-request-body research R13; tasks T021). */

const MODEL: StepBodyEditModel = { kind: "json", text: '{\n  "quantity": 1\n}', edited: false, mismatches: [], replacements: [] };

type OnSave = (input: BodyEditInput) => Promise<PerformanceErrorResult | null>;

function renderEditor(overrides: { model?: StepBodyEditModel; busy?: boolean; onSave?: OnSave } = {}) {
  const onSave = vi.fn<OnSave>(overrides.onSave ?? (async () => null));
  render(<StepBodyEditor stepId="s-1" operationKey="POST /orders" model={overrides.model ?? MODEL} stepLabel={(id) => (id === "s-0" ? "POST /accounts" : id)} busy={overrides.busy ?? false} onSave={onSave} />);
  return { onSave };
}

describe("StepBodyEditor", () => {
  it("opens a labelled editor holding the base body", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    expect(screen.getByRole("textbox", { name: "Body of POST /orders" })).toHaveValue('{\n  "quantity": 1\n}');
  });

  it("offers to add a body when the step sends none", () => {
    renderEditor({ model: { ...MODEL, text: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a body" }));
    expect(screen.getByRole("textbox", { name: "Body of POST /orders" })).toHaveValue("");
  });

  it("saves the text with the model's kind and closes the editor", async () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Body of POST /orders" }), { target: { value: '{"quantity": 3}' } });
    fireEvent.click(screen.getByRole("button", { name: "Save body" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ kind: "json", text: '{"quantity": 3}' }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Body of POST /orders" })).not.toBeInTheDocument());
  });

  it("cancels without saving and restores the text", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Body of POST /orders" }), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    expect(screen.getByRole("textbox", { name: "Body of POST /orders" })).toHaveValue('{\n  "quantity": 1\n}');
  });

  it("shows a refusal next to the editor, keeps the text and focus there", async () => {
    const refusal: PerformanceErrorResult = { ok: false, error: "invalid_body", message: "Not valid JSON at line 1, column 14.", stepId: "s-1", line: 1, column: 14 };
    renderEditor({ onSave: vi.fn(async () => refusal) });
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    const textbox = screen.getByRole("textbox", { name: "Body of POST /orders" });
    fireEvent.change(textbox, { target: { value: '{"quantity": }' } });
    fireEvent.click(screen.getByRole("button", { name: "Save body" }));
    expect(await screen.findByText("Not valid JSON at line 1, column 14.")).toBeInTheDocument();
    expect(textbox).toHaveValue('{"quantity": }');
    expect(textbox).toHaveAccessibleDescription(/Not valid JSON at line 1, column 14\./);
    expect(document.activeElement).toBe(textbox);
  });

  it("lists schema mismatches in words, and they do not block saving", () => {
    renderEditor({
      model: {
        ...MODEL,
        edited: true,
        mismatches: [{ fieldPath: "quantity", rule: "minimum", message: "`quantity` is below the documented minimum of 1." }],
      },
    });
    expect(screen.getByText("Differs from the specification")).toBeInTheDocument();
    expect(screen.getByText("`quantity` is below the documented minimum of 1.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    expect(screen.getByRole("button", { name: "Save body" })).toBeEnabled();
  });

  it("disables saving while the plan is busy", () => {
    renderEditor({ busy: true });
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    expect(screen.getByRole("button", { name: "Save body" })).toBeDisabled();
  });
});

/** AP-033 US3 (specs/033-edit-step-request-body research R4, R8; tasks T036). */
describe("StepBodyEditor references and secrets", () => {
  it("states, while editing, that typed values go into the script and secrets must be references (FR-012)", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    expect(screen.getByText(LITERAL_VALUES_NOTE)).toBeInTheDocument();
  });

  it("lists each field ApiPilot fills at run time and where its value comes from (FR-009)", () => {
    renderEditor({
      model: {
        ...MODEL,
        replacements: [
          { fieldPath: "customerEmail", reference: { kind: "unique-per-iteration", name: "apipilot_unique_0", format: "email" } },
          { fieldPath: "shipping.city", reference: { kind: "workflow-variable", name: "wf_shipCity", variable: "shipCity", producerStepId: "s-0" } },
          { fieldPath: "password", reference: { kind: "environment", name: "password", secret: true } },
        ],
      },
    });
    const list = screen.getByText("Replaced at run time").nextElementSibling as HTMLElement;
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("customerEmail: unique per virtual user and iteration (email)");
    expect(items[1]).toHaveTextContent("shipping.city: from step POST /accounts");
    expect(items[2]).toHaveTextContent("password: from environment: password");
    expect(within(items[2]).getByText("secret")).toBeInTheDocument();
  });

  it("names the field of a password-field refusal", async () => {
    const refusal: PerformanceErrorResult = {
      ok: false,
      error: "body_secret_literal",
      message: "`pin` is a password field. Reference an environment value as {{name}} instead of typing a value.",
      stepId: "s-1",
      fieldPath: "pin",
    };
    renderEditor({ onSave: vi.fn(async () => refusal) });
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    fireEvent.click(screen.getByRole("button", { name: "Save body" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("`pin` is a password field.");
  });
});

/** AP-033 US4 (FR-017; tasks T043). */
describe("StepBodyEditor reset", () => {
  it("resets an edited body after confirmation, and not on cancel", async () => {
    const onReset = vi.fn(async () => null);
    render(
      <StepBodyEditor
        stepId="s-1"
        operationKey="POST /orders"
        model={{ ...MODEL, edited: true }}
        stepLabel={(id) => id}
        busy={false}
        onSave={vi.fn(async () => null)}
        onReset={onReset}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset to generated body" }));
    const dialog = screen.getByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("The body of POST /orders goes back to the body generated from the specification.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset to generated body" }));
    fireEvent.click(within(screen.getByTestId("confirm-dialog")).getByRole("button", { name: /Reset body/ }));
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
  });

  it("offers no reset for a body that was never edited", () => {
    renderEditor();
    expect(screen.queryByRole("button", { name: "Reset to generated body" })).not.toBeInTheDocument();
  });
});
