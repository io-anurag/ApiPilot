import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiModel, ExportResult, TestModel } from "@apipilot/shared-domain";
import { PostmanExportPanel } from "../../src/components/PostmanExportPanel";

const SUPPLIED_TOKEN = "supplied-secret-token-value";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

const testModel: TestModel = { scenarios: [] };

function resultWithTokenValue(tokenValue: string): ExportResult {
  return {
    collection: {
      info: {
        name: "ApiPilot API tests",
        _postman_id: "id",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [
        { key: "baseUrl", value: "" },
        { key: "token", value: "" },
      ],
      item: [
        {
          name: "sessions",
          item: [
            {
              id: "item-1",
              name: "POST /sessions — positive",
              request: {
                method: "POST",
                url: {
                  raw: "{{baseUrl}}/sessions",
                  host: ["{{baseUrl}}"],
                  path: ["sessions"],
                  query: [],
                  variable: [],
                },
                header: [{ key: "Authorization", value: "{{token}}" }],
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
        { key: "token", value: tokenValue, type: "secret", enabled: true },
      ],
    },
    readme: "# ApiPilot API tests\n",
    validation: { valid: true, problems: [] },
    limitations: [],
    summary: { requestCount: 1, folderCount: 1, byProvenance: { RULE: 1, AI: 0 } },
  };
}

function mockFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response);
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch(resultWithTokenValue("")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function exportOnce() {
  fireEvent.click(screen.getByRole("button", { name: /export collection/i }));
  await waitFor(() => expect(screen.getByTestId("export-success")).toBeInTheDocument());
}

describe("PostmanExportPanel secret handling", () => {
  it("offers a labelled input for each variable the collection references", async () => {
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    await exportOnce();

    const tokenInput = screen.getByLabelText("token");
    expect(tokenInput).toBeInTheDocument();
    expect(tokenInput).toHaveAttribute("type", "password");
    // baseUrl has its own field and is not duplicated in the variable list.
    expect(screen.getByTestId("postman-export-variables")).not.toHaveTextContent("baseUrl");
  });

  it("sends supplied credential values as export options", async () => {
    const fetchMock = mockFetch(resultWithTokenValue(""));
    vi.stubGlobal("fetch", fetchMock);
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    await exportOnce();

    fireEvent.change(screen.getByLabelText("token"), { target: { value: SUPPLIED_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body.options.variableValues).toEqual({ token: SUPPLIED_TOKEN });
  });

  it("never renders a supplied credential value back to the page", async () => {
    vi.stubGlobal("fetch", mockFetch(resultWithTokenValue(SUPPLIED_TOKEN)));
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    await exportOnce();

    expect(screen.queryByText(new RegExp(SUPPLIED_TOKEN))).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SUPPLIED_TOKEN);
  });

  it("offers the environment file as its own download", async () => {
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    await exportOnce();

    const link = screen.getByRole("link", { name: /environment\.json/ });
    expect(link).toHaveAttribute("download", "environment.json");
  });

  it("explains that supplied values go to the environment file only", async () => {
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    await exportOnce();

    expect(screen.getByTestId("postman-export-variables")).toHaveTextContent(
      /written to the environment file only/i,
    );
  });
});
