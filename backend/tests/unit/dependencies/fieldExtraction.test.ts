import { describe, expect, it } from "vitest";
import {
  extractConsumerFields,
  extractProducerFields,
} from "../../../src/dependencies/fieldExtraction";
import {
  crudChainApiModel,
  nestedIdentifierApiModel,
  securityParameterApiModel,
} from "../../fixtures/dependencies/dependencyFixtures";

describe("extractProducerFields", () => {
  it("extracts fields only from 2xx response schemas", () => {
    const operation = crudChainApiModel.operations[0]; // POST /users -> 201 only
    const fields = extractProducerFields(operation);
    expect(fields.map((f) => f.field)).toEqual(expect.arrayContaining(["id", "name"]));
  });

  it("never extracts fields from 4xx/5xx responses", () => {
    const operationWithError = {
      ...crudChainApiModel.operations[0],
      responses: [
        ...crudChainApiModel.operations[0].responses,
        {
          statusCode: "400",
          description: "Bad request",
          contentTypes: {
            "application/json": {
              type: "object" as const,
              required: [],
              properties: { errorCode: { required: [], properties: {}, type: "string" as const } },
            },
          },
          examples: {},
        },
      ],
    };
    const fields = extractProducerFields(operationWithError);
    expect(fields.map((f) => f.field)).not.toContain("errorCode");
  });

  it("discovers a nested identifier field as a dotted path", () => {
    const operation = nestedIdentifierApiModel.operations[0]; // POST /sessions -> { user: { id } }
    const fields = extractProducerFields(operation);
    expect(fields.map((f) => f.field)).toContain("user.id");
  });
});

describe("extractConsumerFields", () => {
  it("includes path, query, and header parameters and request-body fields", () => {
    const operation = crudChainApiModel.operations[2]; // PUT /users/{userId}
    const fields = extractConsumerFields(operation, crudChainApiModel.securitySchemes);
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "userId", location: "path" }),
        expect.objectContaining({ field: "displayName", location: "body" }),
      ]),
    );
  });

  it("excludes a parameter that duplicates a declared apiKey security requirement", () => {
    const operation = securityParameterApiModel.operations[0]; // GET /widgets/{widgetId}
    const fields = extractConsumerFields(operation, securityParameterApiModel.securitySchemes);
    expect(fields.some((f) => f.field === "X-Api-Key")).toBe(false);
    expect(fields.some((f) => f.field === "widgetId" && f.location === "path")).toBe(true);
  });
});
