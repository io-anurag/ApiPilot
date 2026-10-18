import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ApiModel, ApiOperation, ImportAnalysisReport } from "@apipilot/shared-domain";
import { ApiReviewStage } from "../../src/components/ApiReviewStage";

const report: ImportAnalysisReport = {
  counts: { total: 6, imported: 4, excluded: 1, malformed: 1, operations: 2 },
  exclusions: [{ reason: "redirect", count: 1, samples: [{ entryIndex: 2, method: "GET", host: "api.shop.test", path: "/old" }] }],
  malformedEntries: [{ entryIndex: 5, reason: "missing-url" }],
  origins: [{ origin: "https://api.shop.test", importedEntries: 4, operations: 2 }],
  normalization: { trailingSlashesFolded: 0, duplicateSlashesCollapsed: 0, dotSegmentsRemoved: 0 },
  credentialUrlCount: 0,
  credentialUrlEntries: [],
  limitsApplied: [],
};

const orderById: ApiOperation = {
  path: "/v1/orders/{orderId}",
  method: "GET",
  operationId: undefined,
  parameters: [
    {
      name: "orderId",
      location: "path",
      required: true,
      schema: { type: "string", required: [], properties: {} },
      provenance: { origin: "inferred", observationCount: 3, confidence: "high" },
    },
    {
      name: "expand",
      location: "query",
      required: false,
      requiredUnknown: true,
      schema: { required: [], properties: {} },
      provenance: { origin: "observed", observationCount: 1, confidence: "low" },
    },
  ],
  requestBody: undefined,
  responses: [
    { statusCode: "200", description: "", contentTypes: {}, examples: {}, provenance: { origin: "observed", observationCount: 2, confidence: "medium" } },
    { statusCode: "404", description: "", contentTypes: {}, examples: {}, provenance: { origin: "observed", observationCount: 1, confidence: "low" }, bodyUnavailable: "compressed" },
  ],
  security: [],
  tags: [],
  provenance: { origin: "observed", observationCount: 3, confidence: "high" },
  observed: {
    key: "abc123abc123",
    origin: "https://api.shop.test",
    observationCount: 3,
    statusCounts: { "200": 2, "404": 1 },
    pathParameters: [
      {
        name: "orderId",
        position: 2,
        distinctValues: 3,
        exampleValues: ["ord_7f3a9c21d4", "ord_1b2c3d4e5f60", "ord_a9b8c7d6e5f4"],
        provenance: { origin: "inferred", observationCount: 3, confidence: "high" },
      },
    ],
    queryParameterCounts: { expand: 1 },
    headerCounts: { authorization: 3 },
    requestExamples: [
      {
        pathParameters: { orderId: "ord_7f3a9c21d4" },
        queryParameters: {},
        headers: { authorization: "[redacted:token]" },
        responseStatus: "200",
        observations: 2,
        firstEntryIndex: 3,
      },
    ],
    droppedExampleCount: 1,
    requestBodyEvidence: {},
    responseBodyEvidence: {},
    unavailableBodies: [{ direction: "response", reason: "compressed", count: 1 }],
    credentialsObserved: [{ location: "header", name: "authorization", kind: "token", observations: 3 }],
  },
};

const orders: ApiOperation = { ...orderById, path: "/v1/orders", parameters: [], responses: [], provenance: { origin: "observed", observationCount: 1, confidence: "low" }, observed: { ...orderById.observed!, pathParameters: [], requestExamples: [], droppedExampleCount: 0, credentialsObserved: [] } };

const harModel: ApiModel = {
  operations: [orderById, orders],
  securitySchemes: {},
  summary: {
    operationCount: 2,
    schemaCount: 0,
    securitySchemeCount: 0,
    issues: [
      { kind: "ambiguous-path", location: "GET /v1/invoices/inv_55aa66bb77cc", message: "kept literal" },
      { kind: "conflicting-types", location: "GET /v1/stats", message: "count conflicts" },
      { kind: "unsupported-content", location: "GET /v1/blob", message: "binary body" },
      { kind: "incomplete-observation", location: "GET /v1/cut", message: "cut short" },
      { kind: "credential-detected", location: "GET /v1/orders", message: "credentials replaced" },
    ],
  },
  importReport: report,
};

const openApiModel: ApiModel = {
  operations: [
    {
      path: "/pets",
      method: "GET",
      operationId: "listPets",
      parameters: [{ name: "limit", location: "query", required: true, schema: { type: "integer", required: [], properties: {} } }],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "A list of pets", contentTypes: {}, examples: {} }],
      security: [],
      tags: [],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 1, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

function openDetails(path: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(path.replace(/[{}]/g, "\\$&")) }));
  return screen.getByTestId("operation-detail");
}

describe("ApiReviewStage for a HAR-derived model (specs/056 US3)", () => {
  it("shows the import summary above the analysis summary, with counts that add up", () => {
    render(<ApiReviewStage apiModel={harModel} onAdvanced={vi.fn()} />);
    const summary = screen.getByTestId("har-import-summary");
    const analysis = screen.getByTestId("analysis-summary");
    expect(summary.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("har-import-reconciliation")).toHaveTextContent("4 imported + 1 excluded + 1 malformed = 6");
  });

  it("shows every inference warning through the existing issue list, with its operation or entry", () => {
    render(<ApiReviewStage apiModel={harModel} onAdvanced={vi.fn()} />);
    const issues = screen.getByTestId("analysis-issues");
    expect(issues).toHaveTextContent("5 issues found");
    for (const kind of ["ambiguous-path", "conflicting-types", "unsupported-content", "incomplete-observation", "credential-detected"]) {
      expect(issues).toHaveTextContent(kind);
    }
    expect(issues).toHaveTextContent("GET /v1/invoices/inv_55aa66bb77cc");
    expect(issues).toHaveTextContent("GET /v1/stats");
  });

  it("labels each parameter, status and path decision by origin with its observation count", () => {
    render(<ApiReviewStage apiModel={harModel} onAdvanced={vi.fn()} />);
    const detail = openDetails("/v1/orders/{orderId}");
    expect(within(detail).getAllByTestId("fact-origin-badge").map((b) => b.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining([
        "Observed, 3 observations, high confidence",
        "Inferred, 3 observations, high confidence",
        "Observed, 1 observation, low confidence",
        "Observed, 2 observations, medium confidence",
      ]),
    );
    expect(detail).toHaveTextContent("(requirement unknown)");
    expect(detail).toHaveTextContent("orderId} was inferred because segment 3 took 3 different values");
    expect(detail).toHaveTextContent("ord_7f3a9c21d4, ord_1b2c3d4e5f60, ord_a9b8c7d6e5f4");
  });

  it("shows seen-count, origin, examples with redacted values, credentials without values and unavailable bodies", () => {
    render(<ApiReviewStage apiModel={harModel} onAdvanced={vi.fn()} />);
    const detail = openDetails("/v1/orders/{orderId}");
    expect(within(detail).getByTestId("operation-origin")).toHaveTextContent("Seen 3 times on https://api.shop.test");
    expect(within(detail).getByTestId("operation-origin")).toHaveTextContent("never used as a test target");
    const examples = within(detail).getByTestId("operation-request-examples");
    expect(examples).toHaveTextContent("Seen 2 times, returned 200");
    expect(examples).toHaveTextContent("1 more distinct example was seen and not kept");
    expect(examples).toHaveTextContent("[redacted:token]");
    expect(within(detail).getByTestId("operation-credentials")).toHaveTextContent("token in header authorization, seen in 3 entries");
    expect(detail).toHaveTextContent("(body unavailable: compressed, and ApiPilot does not decompress it)");
    expect(detail).toHaveTextContent("No security scheme observed");
  });

  it("does not show a dash and an empty description for an observed status", () => {
    render(<ApiReviewStage apiModel={harModel} onAdvanced={vi.fn()} />);
    const detail = openDetails("/v1/orders/{orderId}");
    expect(detail).not.toHaveTextContent("200 -");
  });

  it("still lets the user select operations and continue, as for any input", () => {
    const onAdvanced = vi.fn();
    render(<ApiReviewStage apiModel={harModel} onAdvanced={onAdvanced} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Select all (2)"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});

describe("ApiReviewStage for an OpenAPI model is unchanged", () => {
  it("shows no import summary, origin badge or observation text", () => {
    render(<ApiReviewStage apiModel={openApiModel} onAdvanced={vi.fn()} />);
    expect(screen.queryByTestId("har-import-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("declared-base-url")).not.toBeInTheDocument();
    const detail = openDetails("/pets");
    expect(within(detail).queryByTestId("fact-origin-badge")).not.toBeInTheDocument();
    expect(within(detail).queryByTestId("operation-origin")).not.toBeInTheDocument();
    expect(detail).toHaveTextContent("limit (query) (required)");
    expect(detail).toHaveTextContent("200 - A list of pets");
    expect(detail).toHaveTextContent("No security requirement");
  });

  it("shows a declared base URL as informational when the model has one", () => {
    render(<ApiReviewStage apiModel={{ ...openApiModel, declaredBaseUrl: "https://api.example.test" }} onAdvanced={vi.fn()} />);
    expect(screen.getByTestId("declared-base-url")).toHaveTextContent("https://api.example.test");
    expect(screen.getByTestId("declared-base-url")).toHaveTextContent("never used as a test target");
  });
});

describe("ApiReviewStage for a definition-derived model (specs/056 US6)", () => {
  const declared = { origin: "declared" as const };
  const definitionModel: ApiModel = {
    operations: [
      {
        path: "/orders/{orderId}",
        method: "GET",
        operationId: "getOrder",
        description: "Fetch one order.",
        provenance: declared,
        parameters: [
          { name: "orderId", location: "path", required: true, schema: { type: "string", required: [], properties: {} }, provenance: declared },
          { name: "expand", location: "query", required: false, requiredUnknown: true, schema: { required: [], properties: {} }, provenance: declared },
        ],
        requestBody: undefined,
        responses: [{ statusCode: "200", description: "The order.", contentTypes: {}, examples: {}, provenance: declared }],
        security: [],
        tags: ["orders"],
      },
    ],
    securitySchemes: {},
    summary: { operationCount: 1, schemaCount: 2, securitySchemeCount: 0, issues: [] },
    info: { title: "Orders API", version: "1.0.0" },
    declaredBaseUrl: "https://api.example.test",
  };

  it("labels the operation, each parameter and each status as declared, with no observation count", () => {
    render(<ApiReviewStage apiModel={definitionModel} onAdvanced={vi.fn()} />);
    const detail = openDetails("/orders/{orderId}");
    const badges = within(detail).getAllByTestId("fact-origin-badge");
    expect(badges.length).toBeGreaterThanOrEqual(4);
    for (const badge of badges) {
      expect(badge).toHaveAttribute("data-origin", "declared");
      expect(badge).toHaveTextContent(/^Declared$/);
    }
  });

  it("says a parameter's requirement is unknown rather than optional", () => {
    render(<ApiReviewStage apiModel={definitionModel} onAdvanced={vi.fn()} />);
    const detail = openDetails("/orders/{orderId}");
    expect(detail).toHaveTextContent("expand (query) (requirement unknown)");
    expect(detail).toHaveTextContent("orderId (path) (required)");
  });

  it("shows the declared base URL as informational and no capture import summary", () => {
    render(<ApiReviewStage apiModel={definitionModel} onAdvanced={vi.fn()} />);
    expect(screen.getByTestId("declared-base-url")).toHaveTextContent("https://api.example.test");
    expect(screen.queryByTestId("har-import-summary")).not.toBeInTheDocument();
  });
});
