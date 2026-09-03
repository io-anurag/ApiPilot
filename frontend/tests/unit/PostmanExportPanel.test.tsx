import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiModel, ExportResult, TestModel } from "@apipilot/shared-domain";
import { PostmanExportPanel } from "../../src/components/PostmanExportPanel";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

const testModel: TestModel = { scenarios: [] };

const exportResult: ExportResult = {
  collection: {
    info: {
      name: "ApiPilot API tests",
      _postman_id: "id",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: "" }],
    item: [
      {
        name: "orders",
        item: [
          {
            id: "item-1",
            name: "GET /orders — positive",
            request: {
              method: "GET",
              url: {
                raw: "{{baseUrl}}/orders",
                host: ["{{baseUrl}}"],
                path: ["orders"],
                query: [],
                variable: [],
              },
              header: [],
            },
          },
        ],
      },
    ],
  },
  environment: {
    name: "ApiPilot API tests environment",
    _postman_variable_scope: "environment",
    values: [
      { key: "baseUrl", value: "", type: "default", enabled: true },
      { key: "token", value: "", type: "secret", enabled: true },
    ],
  },
  readme: "# ApiPilot API tests\n",
  validation: { valid: true, problems: [] },
  limitations: [
    {
      kind: "no-expected-outcome",
      scenarioId: "scenario-1",
      location: "GET /orders",
      message: "The approved scenario carried no assertion.",
    },
  ],
  summary: { requestCount: 1, folderCount: 1, byProvenance: { RULE: 1, AI: 0 } },
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch(200, exportResult));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PostmanExportPanel", () => {
  it("offers an export action with an accessible name", () => {
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    expect(screen.getByRole("button", { name: /export collection/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/base address/i)).toBeInTheDocument();
  });

  it("reports the success state with one download per artifact", async () => {
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    await waitFor(() => expect(screen.getByTestId("export-success")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /collection\.json/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /environment\.json/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /README\.md/ })).toBeInTheDocument();
    expect(screen.getByTestId("export-validation-result")).toHaveTextContent(/validation passed/i);
  });

  it("distinguishes the empty result from a failure", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(400, {
        error: "empty_approved_test_model",
        message: "The approved test model contains no scenarios.",
      }),
    );
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    await waitFor(() => expect(screen.getByTestId("export-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("export-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("export-empty")).toHaveTextContent(/accept at least one scenario/i);
  });

  it("reports a failure with recovery guidance in text, not colour alone", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(400, {
        error: "workflow_intent_unsupported",
        message: "The approved test model carries multi-step workflow intent.",
      }),
    );
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/multi-step workflow intent/i);
    expect(alert).toHaveTextContent(/single-operation scenarios only/i);
    expect(screen.queryByTestId("export-success")).not.toBeInTheDocument();
  });

  it("lists the limitations alongside a successful export", async () => {
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    await waitFor(() => expect(screen.getByTestId("export-limitations")).toBeInTheDocument());
    expect(screen.getByTestId("export-limitation-no-expected-outcome")).toHaveTextContent(
      /GET \/orders/,
    );
  });

  it("sends the supplied base address as an export option", async () => {
    const fetchMock = mockFetch(200, exportResult);
    vi.stubGlobal("fetch", fetchMock);
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);

    fireEvent.change(screen.getByLabelText(/base address/i), {
      target: { value: "https://qa.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.options.baseUrl).toBe("https://qa.example");
  });
});