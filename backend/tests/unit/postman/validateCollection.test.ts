import { describe, expect, it } from "vitest";
import type { ArtifactVariable, PostmanCollection } from "@apipilot/shared-domain";
import { POSTMAN_COLLECTION_SCHEMA } from "@apipilot/shared-domain";
import { validateCollection } from "../../../src/postman/validateCollection";

const declared: ArtifactVariable[] = [
  { name: "baseUrl", purpose: "Address.", secret: false, value: "" },
  { name: "token", purpose: "Bearer token.", secret: true, value: "" },
];

function validCollection(): PostmanCollection {
  return {
    info: { name: "Suite", _postman_id: "collection-id", schema: POSTMAN_COLLECTION_SCHEMA },
    variable: [
      { key: "baseUrl", value: "" },
      { key: "token", value: "" },
    ],
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
              header: [{ key: "Authorization", value: "{{token}}" }],
            },
          },
        ],
      },
      {
        name: "sessions",
        item: [
          {
            id: "item-2",
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
              header: [],
              body: {
                mode: "raw",
                raw: JSON.stringify({ username: "qa", password: "{{password}}" }),
                options: { raw: { language: "json" } },
              },
            },
          },
        ],
      },
    ],
  };
}

function problemsFor(mutate: (collection: PostmanCollection) => void, variables = declared) {
  const collection = validCollection();
  mutate(collection);
  return validateCollection(collection, variables).problems;
}

describe("validateCollection", () => {
  it("passes a well-formed collection", () => {
    expect(validateCollection(validCollection(), declared)).toEqual({
      valid: true,
      problems: [],
    });
  });

  it("requires the top-level info fields", () => {
    expect(problemsFor((collection) => (collection.info.name = ""))).toContainEqual(
      expect.stringContaining("info.name"),
    );
    expect(problemsFor((collection) => (collection.info._postman_id = ""))).toContainEqual(
      expect.stringContaining("info._postman_id"),
    );
  });

  it("requires the v2.1.0 schema identifier", () => {
    const problems = problemsFor(
      (collection) => (collection.info.schema = "https://example.invalid/schema" as never),
    );
    expect(problems).toContainEqual(expect.stringContaining("info.schema"));
  });

  it("requires every URL to begin with the base-address variable", () => {
    const problems = problemsFor(
      (collection) => (collection.item[0].item[0].request.url.raw = "/orders"),
    );
    expect(problems).toContainEqual(expect.stringContaining("does not begin with {{baseUrl}}"));
  });

  it("rejects a literal host", () => {
    const problems = problemsFor((collection) => {
      collection.item[0].item[0].request.url.raw = "{{baseUrl}}https://qa.example/orders";
    });
    expect(problems).toContainEqual(expect.stringContaining("literal host"));
  });

  it("rejects a credential value that is not a variable reference", () => {
    const problems = problemsFor((collection) => {
      collection.item[0].item[0].request.header[0].value = "Bearer sk-live-abc";
    });
    expect(problems).toContainEqual(expect.stringContaining("credential value"));
  });

  it("rejects a credential-named body field carrying a literal value", () => {
    const problems = problemsFor((collection) => {
      collection.item[1].item[0].request.body = {
        mode: "raw",
        raw: JSON.stringify({ password: "hunter2" }),
        options: { raw: { language: "json" } },
      };
    });
    expect(problems).toContainEqual(expect.stringContaining("credential value"));
  });

  it("rejects a reference to a variable that is not declared", () => {
    const problems = problemsFor((collection) => {
      collection.item[0].item[0].request.url.raw = "{{baseUrl}}/orders/{{orderId}}";
    });
    expect(problems).toContainEqual(expect.stringContaining('undeclared variable "orderId"'));
  });

  it("rejects a declared variable that is missing from the collection variable list", () => {
    const problems = problemsFor((collection) => {
      collection.variable = [{ key: "baseUrl", value: "" }];
    });
    expect(problems).toContainEqual(expect.stringContaining('missing the declared variable "token"'));
  });

  it("rejects a value carried in the collection variable list", () => {
    const problems = problemsFor((collection) => {
      collection.variable[0] = { key: "baseUrl", value: "https://qa.example" };
    });
    expect(problems).toContainEqual(expect.stringContaining("must be empty"));
  });

  it("rejects duplicate item ids", () => {
    const problems = problemsFor((collection) => {
      collection.item[1].item[0].id = "item-1";
    });
    expect(problems).toContainEqual(expect.stringContaining("is not unique"));
  });

  it("rejects folders that are out of the defined order", () => {
    const problems = problemsFor((collection) => {
      collection.item = [collection.item[1], collection.item[0]];
    });
    expect(problems).toContainEqual(expect.stringContaining("out of the defined folder order"));
  });

  it("rejects an empty folder", () => {
    const problems = problemsFor((collection) => {
      collection.item[0].item = [];
    });
    expect(problems).toContainEqual(expect.stringContaining("at least one request"));
  });

  it("rejects a listener outside the emitted subset", () => {
    const problems = problemsFor((collection) => {
      collection.item[0].item[0].event = [
        { listen: "prerequest" as never, script: { type: "text/javascript", exec: [] } },
      ];
    });
    expect(problems).toContainEqual(expect.stringContaining('"test" listener'));
  });

  it("names a location and an expectation without quoting payloads or values", () => {
    const problems = problemsFor((collection) => {
      collection.item[1].item[0].request.body = {
        mode: "raw",
        raw: JSON.stringify({ password: "hunter2", note: "confidential payload text" }),
        options: { raw: { language: "json" } },
      };
    });
    expect(problems.join(" ")).toContain("item[1].item[0].request.body.password");
    expect(problems.join(" ")).not.toContain("hunter2");
    expect(problems.join(" ")).not.toContain("confidential payload text");
  });
});
