import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiModel, ExportResult, GenerationLimitation, TestModel } from "@apipilot/shared-domain";
import { PostmanExportLimitations } from "../../src/components/PostmanExportLimitations";
import { PostmanExportPanel } from "../../src/components/PostmanExportPanel";

const limitations: GenerationLimitation[] = [
  {
    kind: "no-expected-outcome",
    scenarioId: "scenario-1",
    location: "GET /orders",
    message: "The approved scenario carried no assertion.",
  },
  {
    kind: "unsupported-auth-scheme",
    location: "POST /sessions",
    message: 'The security scheme "oauth2Auth" is of type "oauth2", which this export cannot configure.',
  },
  {
    kind: "no-expected-outcome",
    scenarioId: "scenario-2",
    location: "GET /reports",
    message: "The approved scenario carried no assertion.",
  },
];

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};
const testModel: TestModel = { scenarios: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PostmanExportLimitations", () => {
  it("groups limitations by kind with a count for each", () => {
    render(<PostmanExportLimitations limitations={limitations} />);
    expect(screen.getByTestId("export-limitation-no-expected-outcome")).toHaveTextContent(
      "Scenarios with no expected outcome (2)",
    );
    expect(screen.getByTestId("export-limitation-unsupported-auth-scheme")).toHaveTextContent(
      "Authentication schemes this export cannot configure (1)",
    );
  });

  it("states each limitation in accessible text rather than colour alone", () => {
    render(<PostmanExportLimitations limitations={limitations} />);
    const section = screen.getByTestId("export-limitations");
    expect(section).toHaveTextContent("GET /orders");
    expect(section).toHaveTextContent("The approved scenario carried no assertion.");
    expect(screen.getByRole("heading", { name: /known limitations \(3\)/i })).toBeInTheDocument();
  });

  it("says so plainly when nothing was left unexpressed", () => {
    render(<PostmanExportLimitations limitations={[]} />);
    expect(screen.getByTestId("export-limitations-none")).toHaveTextContent(
      /every approved scenario was expressed in full/i,
    );
  });
});

function successResult(): ExportResult {
  return {
    collection: {
      info: {
        name: "Suite",
        _postman_id: "id",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [{ key: "baseUrl", value: "" }],
      item: [],
    },
    environment: {
      name: "Suite environment",
      _postman_variable_scope: "environment",
      values: [{ key: "baseUrl", value: "", type: "default", enabled: true }],
    },
    readme: "# Suite\n",
    validation: { valid: true, problems: [] },
    limitations,
    summary: { requestCount: 3, folderCount: 1, byProvenance: { RULE: 2, AI: 1 } },
  };
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("export panel validation reporting", () => {
  it("presents an export with limitations as successful", async () => {
    vi.stubGlobal("fetch", mockFetch(200, successResult()));
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    await waitFor(() => expect(screen.getByTestId("export-success")).toBeInTheDocument());
    expect(screen.getByTestId("export-limitations")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("presents a validation failure as a failed export and lists the problems", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(500, {
        error: "collection_validation_failed",
        message: "The generated collection did not pass validation and was not returned.",
        problems: ["item[0].item[1].id is not unique"],
      }),
    );
    render(<PostmanExportPanel apiModel={apiModel} testModel={testModel} />);
    fireEvent.click(screen.getByRole("button", { name: /export collection/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not pass validation/i);
    expect(screen.getByTestId("export-validation-problems")).toHaveTextContent(
      "item[0].item[1].id is not unique",
    );
    expect(screen.queryByTestId("export-success")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export-downloads")).not.toBeInTheDocument();
  });
});
