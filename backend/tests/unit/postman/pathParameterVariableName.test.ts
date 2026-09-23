import { describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation, TestModel, TestScenario } from "@apipilot/shared-domain";
import { pathParameterVariableName } from "../../../src/postman/artifactVariables";
import { generateCollection } from "../../../src/postman/generateCollection";

describe("pathParameterVariableName", () => {
  it("prefixes a generic parameter with its singular resource so different resources never share a variable", () => {
    expect(pathParameterVariableName("/api/v1/customers/{id}", "id")).toBe("customer_id");
    expect(pathParameterVariableName("/api/v1/products/{id}", "id")).toBe("product_id");
    expect(pathParameterVariableName("/api/v1/users/{id}", "id")).toBe("user_id");
  });

  it("singularizes common plural forms deterministically", () => {
    expect(pathParameterVariableName("/categories/{id}", "id")).toBe("category_id");
    expect(pathParameterVariableName("/addresses/{id}", "id")).toBe("address_id");
    expect(pathParameterVariableName("/boxes/{id}", "id")).toBe("box_id");
    expect(pathParameterVariableName("/status/{id}", "id")).toBe("status_id");
    expect(pathParameterVariableName("/inventory/{id}", "id")).toBe("inventory_id");
  });

  it("uses the segment immediately before each parameter in a nested path", () => {
    expect(pathParameterVariableName("/users/{userId}/orders/{id}", "id")).toBe("order_id");
    expect(pathParameterVariableName("/users/{id}/orders/{orderId}", "id")).toBe("user_id");
  });

  it("keeps a parameter that already names its resource, whatever its casing style", () => {
    expect(pathParameterVariableName("/users/{userId}", "userId")).toBe("userId");
    expect(pathParameterVariableName("/users/{user_id}", "user_id")).toBe("user_id");
    expect(pathParameterVariableName("/orders/{orderId}", "orderId")).toBe("orderId");
  });

  it("sanitizes a hyphenated resource segment into a valid variable prefix", () => {
    expect(pathParameterVariableName("/order-items/{id}", "id")).toBe("order_item_id");
  });

  it("leaves the name unchanged when no static segment precedes the parameter", () => {
    expect(pathParameterVariableName("/{id}", "id")).toBe("id");
    expect(pathParameterVariableName("/{tenant}/{id}", "id")).toBe("id");
  });
});

function getById(path: string): ApiOperation {
  return {
    path,
    method: "GET",
    operationId: undefined,
    parameters: [{ name: "id", location: "path", required: true, schema: { type: "string", required: [], properties: {} } }],
    requestBody: undefined,
    responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
    security: [],
    tags: [],
  };
}

/** A scenario whose request deliberately omits the `id` path value, so the export must expose it. */
function unresolvedScenario(id: string, operation: ApiOperation): TestScenario {
  return {
    id,
    operationPath: operation.path,
    operationMethod: operation.method,
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [{ type: "status-code", expectedStatusCode: "200" }],
    provenance: { source: "RULE", rule: "positive", description: `Scenario ${id}.`, duplicateOfRules: [] },
  };
}

describe("generateCollection unresolved path parameters", () => {
  const operations = ["/api/v1/customers/{id}", "/api/v1/products/{id}", "/api/v1/users/{id}"].map(getById);
  const apiModel: ApiModel = {
    operations,
    securitySchemes: {},
    summary: { operationCount: 3, schemaCount: 0, securitySchemeCount: 0, issues: [] },
  };
  const testModel: TestModel = {
    scenarios: operations.map((operation, index) => unresolvedScenario(`scenario-${index}`, operation)),
  };

  it("declares one distinct variable per resource and references it from that resource's request", () => {
    const outcome = generateCollection(apiModel, testModel);
    if (!outcome.ok) throw new Error("expected a successful export");
    const collection = outcome.result.collection as unknown as {
      item: { item: { request: { url: { variable: { key: string; value: string }[] } } }[] }[];
    };
    const declared = outcome.result.environment.values.map((variable) => variable.key);
    expect(declared).toEqual(expect.arrayContaining(["customer_id", "product_id", "user_id"]));
    expect(declared).not.toContain("id");

    const pathVariables = collection.item
      .flatMap((folder) => folder.item)
      .flatMap((item) => item.request.url.variable);
    // The Postman `:id` key stays the specification's own parameter name.
    expect(pathVariables.every((variable) => variable.key === "id")).toBe(true);
    expect(pathVariables.map((variable) => variable.value).sort()).toEqual([
      "{{customer_id}}",
      "{{product_id}}",
      "{{user_id}}",
    ]);
  });
});
