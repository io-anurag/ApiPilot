import { describe, expect, it } from "vitest";
import { buildRequestItem } from "../../../src/postman/requestItem";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";

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

function item2Id(result: ReturnType<typeof buildRequestItem>): string {
  return result.item.id;
}