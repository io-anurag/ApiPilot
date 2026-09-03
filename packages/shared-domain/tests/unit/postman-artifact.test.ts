import { describe, expect, it } from "vitest";
import {
  POSTMAN_COLLECTION_SCHEMA,
  type ArtifactVariable,
  type ExportResult,
  type GenerationLimitation,
  type PostmanCollection,
  type PostmanEnvironment,
} from "../../src/postmanArtifact";

describe("postman artifact contracts", () => {
  it("names the v2.1.0 collection schema the generator emits", () => {
    expect(POSTMAN_COLLECTION_SCHEMA).toBe(
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    );
  });

  it("types a collection whose requests address a base-address variable", () => {
    const collection: PostmanCollection = {
      info: { name: "Orders API tests", _postman_id: "id", schema: POSTMAN_COLLECTION_SCHEMA },
      variable: [{ key: "baseUrl", value: "" }],
      item: [
        {
          name: "orders",
          item: [
            {
              id: "item-id",
              name: "POST /orders — positive",
              request: {
                method: "POST",
                url: {
                  raw: "{{baseUrl}}/orders",
                  host: ["{{baseUrl}}"],
                  path: ["orders"],
                  query: [],
                  variable: [],
                },
                header: [{ key: "Content-Type", value: "application/json" }],
              },
            },
          ],
        },
      ],
    };
    expect(collection.item[0].item[0].request.url.host).toEqual(["{{baseUrl}}"]);
  });

  it("types an environment whose credential values are marked secret", () => {
    const environment: PostmanEnvironment = {
      name: "Orders API tests environment",
      _postman_variable_scope: "environment",
      values: [
        { key: "baseUrl", value: "", type: "default", enabled: true },
        { key: "token", value: "", type: "secret", enabled: true },
      ],
    };
    expect(environment.values.find((value) => value.key === "token")?.type).toBe("secret");
  });

  it("types a variable with a purpose and a sensitivity marking", () => {
    const variable: ArtifactVariable = {
      name: "token",
      purpose: "Bearer token for the declared http/bearer security scheme.",
      secret: true,
      value: "",
    };
    expect(variable.secret).toBe(true);
  });

  it("types a limitation as a recorded gap rather than a failure", () => {
    const limitation: GenerationLimitation = {
      kind: "no-expected-outcome",
      scenarioId: "scenario-14",
      location: "POST /orders",
      message: "The approved scenario carried no assertion, so no expected outcome is asserted.",
    };
    expect(limitation.kind).toBe("no-expected-outcome");
  });

  it("counts approved scenarios only by the origins the TestModel carries", () => {
    const summary: ExportResult["summary"] = {
      requestCount: 2,
      folderCount: 1,
      byProvenance: { RULE: 1, AI: 1 },
    };
    expect(Object.keys(summary.byProvenance).sort()).toEqual(["AI", "RULE"]);
  });
});