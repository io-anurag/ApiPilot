import { describe, expect, it } from "vitest";
import type { TestScenario } from "@apipilot/shared-domain";
import { buildRequestItem } from "../../../src/postman/requestItem";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";
import {
  coordsLabelOperation,
  coordsMatrixOperation,
  filterDeepObjectOperation,
  idSimplePathOperation,
  metadataContentEncodedOperation,
  sortDefaultOperation,
  tagsSimpleHeaderOperation,
} from "../../fixtures/postman/parameterFixtures";

const createOrder = exportApiModel.operations[0];
const uploadReport = exportApiModel.operations[2];

function scenarioById(id: string) {
  const found = approvedTestModel.scenarios.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`fixture scenario ${id} is missing`);
  return found;
}

describe("buildRequestItem", () => {
  it("addresses the request through the base-address variable", () => {
    const { item } = buildRequestItem({
      scenario: scenarioById("scenario-order-positive"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — positive",
    });
    expect(item.request.url.host).toEqual(["{{baseUrl}}"]);
    expect(item.request.url.raw.startsWith("{{baseUrl}}")).toBe(true);
    expect(item.request.url.raw).not.toContain("http");
  });

  it("expresses path parameters as :name segments carrying the approved value", () => {
    const { item } = buildRequestItem({
      scenario: scenarioById("scenario-order-positive"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — positive",
    });
    expect(item.request.url.path).toEqual(["orders", ":orderId"]);
    expect(item.request.url.variable).toEqual([{ key: "orderId", value: "order-1" }]);
  });

  it("carries approved query parameters and headers", () => {
    const { item } = buildRequestItem({
      scenario: scenarioById("scenario-order-positive"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — positive",
    });
    expect(item.request.url.query).toEqual([{ key: "dryRun", value: "true" }]);
    expect(item.request.header).toContainEqual({ key: "X-Request-Id", value: "req-1" });
  });

  it("emits the JSON body with the content type re-derived from the ApiModel", () => {
    const { item } = buildRequestItem({
      scenario: scenarioById("scenario-order-positive"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — positive",
    });
    expect(item.request.body?.mode).toBe("raw");
    expect(item.request.body?.options.raw.language).toBe("json");
    expect(item.request.header).toContainEqual({
      key: "Content-Type",
      value: "application/json",
    });
    expect(JSON.parse(item.request.body?.raw ?? "null")).toEqual({
      sku: "0f7d1c1e-0000-4000-8000-000000000000",
      quantity: 2,
    });
  });

  it("preserves a deliberately schema-violating negative body exactly as approved", () => {
    const { item } = buildRequestItem({
      scenario: scenarioById("scenario-order-invalid-type"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — invalid-type",
    });
    expect(JSON.parse(item.request.body?.raw ?? "null")).toEqual({
      sku: "0f7d1c1e-0000-4000-8000-000000000000",
      quantity: "not-a-number",
    });
  });

  it("records an unsupported content type instead of converting the body", () => {
    const { item, limitations } = buildRequestItem({
      scenario: scenarioById("scenario-report-upload"),
      operation: uploadReport,
      requestName: "POST /reports/upload — positive",
    });
    expect(item.request.body).toBeUndefined();
    expect(limitations).toContainEqual(
      expect.objectContaining({
        kind: "unsupported-content-type",
        scenarioId: "scenario-report-upload",
      }),
    );
    expect(item.request.header).not.toContainEqual(
      expect.objectContaining({ key: "Content-Type" }),
    );
  });

  it("declares a variable for a path parameter that has no approved value", () => {
    const { item, limitations, variables } = buildRequestItem({
      scenario: scenarioById("scenario-order-missing-path-value"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — missing-field",
    });
    expect(item.request.url.variable).toEqual([{ key: "orderId", value: "{{orderId}}" }]);
    expect(variables.map((variable) => variable.name)).toContain("orderId");
    expect(limitations).toContainEqual(
      expect.objectContaining({ kind: "unresolved-path-parameter" }),
    );
  });

  it("derives the item id from the scenario id so the request traces back to it", () => {
    const first = buildRequestItem({
      scenario: scenarioById("scenario-order-positive"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — positive",
    });
    const again = buildRequestItem({
      scenario: scenarioById("scenario-order-positive"),
      operation: createOrder,
      requestName: "POST /orders/{orderId} — positive",
    });
    expect(item2Id(again)).toBe(item2Id(first));
  });

  it("orders headers and query parameters by name", () => {
    const scenario = {
      ...scenarioById("scenario-order-positive"),
      request: {
        pathParameters: { orderId: "order-1" },
        queryParameters: { zeta: 1, alpha: 2 },
        headers: { "Z-Header": "z", "A-Header": "a" },
      },
    };
    const { item } = buildRequestItem({
      scenario,
      operation: createOrder,
      requestName: "POST /orders/{orderId} — positive",
    });
    expect(item.request.url.query.map((q) => q.key)).toEqual(["alpha", "zeta"]);
    expect(item.request.header.map((h) => h.key)).toEqual(["A-Header", "Z-Header"]);
  });
});

function scenarioFor(
  operation: typeof sortDefaultOperation,
  request: TestScenario["request"],
): TestScenario {
  return {
    id: `scenario-${operation.operationId}`,
    operationPath: operation.path,
    operationMethod: operation.method,
    category: "positive",
    request,
    assertions: [{ type: "status-code", expectedStatusCode: "200" }],
    provenance: { source: "RULE", rule: "positive", description: "generated for a test", duplicateOfRules: [] },
  };
}

describe("buildRequestItem — array/object query, path, and header serialization (specs/022-openapi-parameter-serialization, US1)", () => {
  it("renders an array query parameter under the default style (form, explode:true) as repeated key=value entries, in order", () => {
    const scenario = scenarioFor(sortDefaultOperation, {
      pathParameters: {},
      queryParameters: { sort: ["name", "-price"] },
      headers: {},
    });
    const { item } = buildRequestItem({ scenario, operation: sortDefaultOperation, requestName: "test" });
    expect(item.request.url.query).toEqual([
      { key: "sort", value: "name" },
      { key: "sort", value: "-price" },
    ]);
    expect(item.request.url.raw).toContain("sort=name&sort=-price");
  });

  it("renders an object query parameter under deepObject as one key[property]=value entry per property", () => {
    const scenario = scenarioFor(filterDeepObjectOperation, {
      pathParameters: {},
      queryParameters: { filter: { status: "active", owner: "alice" } },
      headers: {},
    });
    const { item } = buildRequestItem({ scenario, operation: filterDeepObjectOperation, requestName: "test" });
    expect(item.request.url.query).toEqual([
      { key: "filter[status]", value: "active" },
      { key: "filter[owner]", value: "alice" },
    ]);
  });

  it("renders an array path parameter under the default simple style as a comma-joined segment value", () => {
    const scenario = scenarioFor(idSimplePathOperation, {
      pathParameters: { id: ["a", "b", "c"] },
      queryParameters: {},
      headers: {},
    });
    const { item } = buildRequestItem({ scenario, operation: idSimplePathOperation, requestName: "test" });
    expect(item.request.url.variable).toEqual([{ key: "id", value: "a,b,c" }]);
    expect(item.request.url.path).toEqual(["items", ":id"]);
  });

  it("renders an array header parameter under the default simple style as a comma-joined header value", () => {
    const scenario = scenarioFor(tagsSimpleHeaderOperation, {
      pathParameters: {},
      queryParameters: {},
      headers: { "X-Tags": ["urgent", "vip"] },
    });
    const { item } = buildRequestItem({ scenario, operation: tagsSimpleHeaderOperation, requestName: "test" });
    expect(item.request.header).toContainEqual({ key: "X-Tags", value: "urgent,vip" });
  });

  it("still produces a runnable request for a matrix-style path parameter, using today's plain-text fallback, and records exactly one unresolved-parameter-style limitation (US3, FR-007)", () => {
    const scenario = scenarioFor(coordsMatrixOperation, {
      pathParameters: { coords: [1, 2] },
      queryParameters: {},
      headers: {},
    });
    const { item, limitations } = buildRequestItem({ scenario, operation: coordsMatrixOperation, requestName: "test" });
    expect(item.request.url.variable).toEqual([{ key: "coords", value: "[1,2]" }]);
    expect(limitations).toHaveLength(1);
    expect(limitations[0]).toEqual(
      expect.objectContaining({
        kind: "unresolved-parameter-style",
        scenarioId: scenario.id,
        location: "GET /locations/{coords}",
      }),
    );
    expect(limitations[0].message).toContain("coords");
    expect(limitations[0].message).toContain("matrix");
  });

  it("still produces a runnable request for a label-style path parameter, using today's plain-text fallback, and records exactly one unresolved-parameter-style limitation (US3, FR-007)", () => {
    const scenario = scenarioFor(coordsLabelOperation, {
      pathParameters: { coords: [1, 2] },
      queryParameters: {},
      headers: {},
    });
    const { item, limitations } = buildRequestItem({ scenario, operation: coordsLabelOperation, requestName: "test" });
    expect(item.request.url.variable).toEqual([{ key: "coords", value: "[1,2]" }]);
    expect(limitations).toHaveLength(1);
    expect(limitations[0]).toEqual(
      expect.objectContaining({ kind: "unresolved-parameter-style", scenarioId: scenario.id }),
    );
    expect(limitations[0].message).toContain("coords");
    expect(limitations[0].message).toContain("label");
  });

  it("still produces a runnable request for a content-encoded query parameter, using today's plain-text fallback, and records exactly one unresolved-parameter-style limitation (US3, FR-007)", () => {
    const scenario = scenarioFor(metadataContentEncodedOperation, {
      pathParameters: {},
      queryParameters: { metadata: { a: 1 } },
      headers: {},
    });
    const { item, limitations } = buildRequestItem({ scenario, operation: metadataContentEncodedOperation, requestName: "test" });
    expect(item.request.url.query).toEqual([{ key: "metadata", value: '{"a":1}' }]);
    expect(limitations).toHaveLength(1);
    expect(limitations[0]).toEqual(
      expect.objectContaining({ kind: "unresolved-parameter-style", scenarioId: scenario.id }),
    );
    expect(limitations[0].message).toContain("metadata");
  });
});

describe("buildRequestItem — percent-encoding (specs/022-openapi-parameter-serialization, US2)", () => {
  it("percent-encodes a scalar query value containing &, =, #, ?, and a space", () => {
    const scenario = scenarioFor(sortDefaultOperation, {
      pathParameters: {},
      queryParameters: { sort: "a&b=c#d?e f" },
      headers: {},
    });
    const { item } = buildRequestItem({ scenario, operation: sortDefaultOperation, requestName: "test" });
    expect(item.request.url.query).toEqual([{ key: "sort", value: "a%26b%3Dc%23d%3Fe%20f" }]);
  });

  it("percent-encodes a scalar path value while leaving the {{baseUrl}} variable and literal path text intact", () => {
    const scenario = scenarioFor(idSimplePathOperation, {
      pathParameters: { id: "a&b" },
      queryParameters: {},
      headers: {},
    });
    const { item } = buildRequestItem({ scenario, operation: idSimplePathOperation, requestName: "test" });
    expect(item.request.url.variable).toEqual([{ key: "id", value: "a%26b" }]);
    // The raw URL keeps the :name placeholder — Postman substitutes url.variable's resolved
    // value at send time — so {{baseUrl}} and the literal path text stay intact either way.
    expect(item.request.url.raw).toBe("{{baseUrl}}/items/:id");
    expect(item.request.url.raw.startsWith("{{baseUrl}}")).toBe(true);
  });

  it("individually percent-encodes each array element while the style's own comma separator stays literal (US1 + US2 together)", () => {
    const scenario = scenarioFor(sortDefaultOperation, {
      pathParameters: {},
      queryParameters: { sort: ["a&b", "c"] },
      headers: {},
    });
    const { item } = buildRequestItem({ scenario, operation: sortDefaultOperation, requestName: "test" });
    expect(item.request.url.query).toEqual([
      { key: "sort", value: "a%26b" },
      { key: "sort", value: "c" },
    ]);
  });
});

function item2Id(result: ReturnType<typeof buildRequestItem>): string {
  return result.item.id;
}