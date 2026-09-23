import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiModel, ApiOperation, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { ApiReviewStage } from "../../src/components/ApiReviewStage";
import * as client from "../../src/services/testGenerationWorkflowClient";

function operation(method: string, path: string): ApiOperation {
  return {
    method,
    path,
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: [],
    security: [],
    tags: [],
  };
}

const apiModel: ApiModel = {
  operations: [operation("get", "/pets"), operation("post", "/pets"), operation("delete", "/pets/{id}")],
  securitySchemes: {},
  summary: { operationCount: 3, schemaCount: 1, securitySchemeCount: 0, issues: [] },
};

function summaryPanel() {
  return within(screen.getByTestId("api-review-summary-panel"));
}

/** The summary's headline number, read from the element preceding its label. */
function summaryStat(label: string | RegExp): string | null | undefined {
  return summaryPanel().getByText(label).previousElementSibling?.textContent;
}

describe("ApiReviewStage operation selection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps Continue disabled, with an explanation, until an operation is selected", () => {
    render(<ApiReviewStage apiModel={apiModel} onAdvanced={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(summaryPanel().getByText(/Select at least one operation to continue/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Include POST /pets" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("updates the summary count and method breakdown to the selected operations", () => {
    render(<ApiReviewStage apiModel={apiModel} onAdvanced={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include DELETE /pets/{id}" }));

    expect(summaryStat("of 3 operations selected")).toBe("1");
    expect(summaryPanel().getByText("DELETE")).toBeInTheDocument();
    expect(summaryPanel().queryByText("GET")).not.toBeInTheDocument();
  });

  it("updates the summary after Select all when operations are deselected again", () => {
    render(<ApiReviewStage apiModel={apiModel} onAdvanced={vi.fn()} />);
    const selectAll = screen.getByRole("checkbox", { name: "Select all (3)" });

    fireEvent.click(selectAll);
    expect(summaryStat("of 3 operations selected")).toBe("3");

    fireEvent.click(screen.getByRole("checkbox", { name: "Include GET /pets" }));
    expect(summaryStat("of 3 operations selected")).toBe("2");
    expect(summaryPanel().queryByText("GET")).not.toBeInTheDocument();
    expect(selectAll).not.toBeChecked();
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);

    // Clearing everything must not fall back to showing every operation.
    fireEvent.click(selectAll);
    fireEvent.click(selectAll);
    expect(summaryStat("of 3 operations selected")).toBe("0");
    expect(summaryPanel().queryByText("POST")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("selects every operation through Select all and sends exactly the selected keys", async () => {
    const workflow = { id: "wf" } as TestGenerationWorkflow;
    const continueSpy = vi
      .spyOn(client, "continueApiReview")
      .mockResolvedValue({ ok: true, workflow });
    const onAdvanced = vi.fn();
    render(<ApiReviewStage apiModel={apiModel} onAdvanced={onAdvanced} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all (3)" }));
    expect(summaryStat("of 3 operations selected")).toBe("3");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include GET /pets" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
    expect(continueSpy).toHaveBeenCalledWith(["POST /pets", "DELETE /pets/{id}"]);
  });

  it("shows the recorded selection read-only once the stage is complete", () => {
    render(
      <ApiReviewStage
        apiModel={apiModel}
        onAdvanced={vi.fn()}
        readOnly
        selectedOperationKeys={["GET /pets"]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    const recorded = screen.getByRole("checkbox", { name: "Include GET /pets" });
    expect(recorded).toBeChecked();
    expect(recorded).toBeDisabled();
    expect(summaryStat("of 3 operations selected")).toBe("1");
  });

  it("reports every operation as carried forward when a completed stage recorded no subset", () => {
    render(<ApiReviewStage apiModel={apiModel} onAdvanced={vi.fn()} readOnly />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(summaryStat("operations discovered")).toBe("3");
    expect(summaryPanel().getByText(/All 3 discovered operations were carried/)).toBeInTheDocument();
  });
});
