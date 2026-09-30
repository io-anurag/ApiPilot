import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PerformanceResult, StepParameterEditModel } from "@apipilot/shared-domain";
import { StepParameterEditor } from "../../src/components/performance/StepParameterEditor";
import { unexpectedStatusesByStep } from "../../src/components/performance/performanceViewModel";

/** AP-033 FR-020 to FR-023 (amended 2026-09-30): editing a step's parameters, and marking failing steps. */

const MODEL: StepParameterEditModel = {
  edited: false,
  rows: [
    { location: "query", name: "limit", required: false, type: "integer", format: null, enum: null, generated: "1", edit: null, notEditable: null, secret: false },
    { location: "query", name: "sort", required: false, type: "string", format: null, enum: ["newest", "oldest"], generated: "newest", edit: null, notEditable: null, secret: false },
    { location: "query", name: "tags", required: false, type: "array", format: null, enum: null, generated: null, edit: null, notEditable: "structured-value", secret: false },
    { location: "query", name: "ref", required: false, type: "string", format: null, enum: null, generated: "{{wf.ref}}", edit: null, notEditable: "filled-at-run-time", secret: false },
    { location: "header", name: "X-Tenant", required: true, type: "string", format: null, enum: null, generated: "tenant", edit: null, notEditable: null, secret: false },
  ],
};

function renderEditor(model: StepParameterEditModel = MODEL, onSave = vi.fn(async () => null)) {
  render(<StepParameterEditor operationKey="GET /api/v1/posts" model={model} busy={false} onSave={onSave} />);
  return onSave;
}

describe("StepParameterEditor", () => {
  it("shows each documented parameter with what is generated and what is sent", () => {
    renderEditor({ ...MODEL, edited: true, rows: MODEL.rows.map((row) => (row.name === "limit" ? { ...row, edit: { action: "omit" } } : row)) });
    const table = screen.getByRole("table", { name: "Documented parameters of GET /api/v1/posts" });
    const limit = within(table).getByText("limit").closest("tr")!;
    expect(limit).toHaveTextContent("Left out");
    expect(within(table).getByText("sort").closest("tr")).toHaveTextContent("One of: newest, oldest");
    expect(screen.getByText("Parameters edited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to generated parameters" })).toBeInTheDocument();
  });

  it("sends a changed value and a left-out parameter, never a parameter filled at run time", async () => {
    const onSave = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit parameters" }));
    fireEvent.change(screen.getByLabelText("Value of query parameter sort"), { target: { value: "oldest" } });
    const limitRow = screen.getByText("limit").closest("tr")!;
    fireEvent.click(within(limitRow).getByRole("checkbox"));
    // A required parameter is always sent; a parameter filled from an earlier step has no control.
    expect(within(screen.getByText("X-Tenant").closest("tr")!).getByRole("checkbox")).toBeDisabled();
    expect(within(screen.getByText("ref").closest("tr")!).queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("An array or object: it can be left out, not edited.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save parameters" }));

    const [input] = onSave.mock.calls[0] as unknown as [{ parameters: { name: string; action: string; value?: string }[] }];
    expect(input.parameters).toEqual([
      { location: "query", name: "limit", action: "omit" },
      { location: "query", name: "sort", action: "set", value: "oldest" },
      { location: "query", name: "tags", action: "omit" },
      { location: "header", name: "X-Tenant", action: "set", value: "tenant" },
    ]);
    expect(await screen.findByRole("button", { name: "Edit parameters" })).toBeInTheDocument();
  });

  it("shows a refusal on the parameter it names and keeps the editor open", async () => {
    const onSave = vi.fn(async () => ({ ok: false as const, error: "parameter_secret_literal", message: '"sort" is a password parameter.', location: "query", name: "sort" }));
    renderEditor(MODEL, onSave);
    fireEvent.click(screen.getByRole("button", { name: "Edit parameters" }));
    fireEvent.click(screen.getByRole("button", { name: "Save parameters" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('"sort" is a password parameter.');
    expect(screen.getByLabelText("Value of query parameter sort")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Value of query parameter limit")).toHaveAttribute("aria-invalid", "false");
  });

  it("resets to the generated parameters after confirmation", async () => {
    const onSave = renderEditor({ ...MODEL, edited: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset to generated parameters" }));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Reset parameters/ }));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});

describe("unexpectedStatusesByStep", () => {
  const step = (overrides: Partial<PerformanceResult["steps"][number]>): PerformanceResult["steps"][number] => ({
    stepId: "s-1",
    operationKey: "GET /api/v1/posts",
    method: "GET",
    expectedStatuses: [{ code: "200", source: "specification" }],
    requests: 7_422,
    latencyMs: null,
    throughputPerSecond: 1,
    errorRatePercent: 100,
    errorsByStatus: [{ status: "400", count: 7_422 }],
    errorsByCategory: [],
    checkPassRatePercent: 0,
    notAttempted: { missingData: 0, dependencyNotAttempted: 0 },
    missingVariables: [],
    ...overrides,
  });

  it("lists, per step, the statuses a finished run received that the step does not expect", () => {
    const result = {
      steps: [
        step({ statusesReceived: [{ status: "0", count: 2, expected: false }, { status: "200", count: 5, expected: true }, { status: "400", count: 7_422, expected: false }] }),
        step({ stepId: "s-2", errorsByStatus: [], statusesReceived: [{ status: "200", count: 9, expected: true }] }),
        // A run recorded before every status was kept: its failure statuses.
        step({ stepId: "s-3" }),
      ],
    } as unknown as PerformanceResult;
    expect([...unexpectedStatusesByStep(result)]).toEqual([
      ["s-1", "no response × 2, 400 × 7,422"],
      ["s-3", "400 × 7,422"],
    ]);
    expect(unexpectedStatusesByStep(undefined).size).toBe(0);
  });
});
