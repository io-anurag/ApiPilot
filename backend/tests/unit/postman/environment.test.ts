import { describe, expect, it } from "vitest";
import type { ArtifactVariable } from "@apipilot/shared-domain";
import { buildEnvironment } from "../../../src/postman/environment";
import { generateCollection } from "../../../src/postman/generateCollection";
import { approvedTestModel, exportApiModel } from "../../fixtures/postman/exportFixtures";

const variables: ArtifactVariable[] = [
  { name: "token", purpose: "Bearer token.", secret: true, value: "" },
  { name: "baseUrl", purpose: "Address the collection runs against.", secret: false, value: "" },
];

describe("buildEnvironment", () => {
  it("declares one entry per variable, ordered by name", () => {
    const environment = buildEnvironment("Suite", variables);
    expect(environment.values.map((value) => value.key)).toEqual(["baseUrl", "token"]);
    expect(environment._postman_variable_scope).toBe("environment");
    expect(environment.name).toBe("Suite environment");
  });

  it("types credential variables as secret and others as default", () => {
    const environment = buildEnvironment("Suite", variables);
    expect(environment.values.find((value) => value.key === "token")?.type).toBe("secret");
    expect(environment.values.find((value) => value.key === "baseUrl")?.type).toBe("default");
  });

  it("keeps an unsupplied variable empty rather than inventing a value", () => {
    const environment = buildEnvironment("Suite", variables);
    expect(environment.values.every((value) => value.value === "")).toBe(true);
    expect(environment.values.every((value) => value.enabled)).toBe(true);
  });
});

describe("environment artifact within a full export", () => {
  it("declares every variable the collection references", () => {
    const outcome = generateCollection(exportApiModel, approvedTestModel);
    if (!outcome.ok) throw new Error("expected a successful export");
    const referenced = new Set(
      [...JSON.stringify(outcome.result.collection).matchAll(/\{\{([^}"]+)\}\}/g)].map(
        (match) => match[1],
      ),
    );
    const declared = new Set(outcome.result.environment.values.map((value) => value.key));
    for (const name of referenced) expect(declared).toContain(name);
    expect(declared).toContain("baseUrl");
  });

  it("writes supplied values into the environment and never into the collection", () => {
    const outcome = generateCollection(exportApiModel, approvedTestModel, {
      baseUrl: "https://qa.internal.example",
      variableValues: { token: "super-secret-token" },
    });
    if (!outcome.ok) throw new Error("expected a successful export");

    const environmentToken = outcome.result.environment.values.find(
      (value) => value.key === "token",
    );
    expect(environmentToken).toEqual({
      key: "token",
      value: "super-secret-token",
      type: "secret",
      enabled: true,
    });
    expect(JSON.stringify(outcome.result.collection)).not.toContain("super-secret-token");
    expect(JSON.stringify(outcome.result.collection)).not.toContain("qa.internal.example");
    expect(outcome.result.readme).not.toContain("super-secret-token");
  });

  it("refuses a supplied value for a variable the collection does not reference", () => {
    const outcome = generateCollection(exportApiModel, approvedTestModel, {
      variableValues: { notAVariable: "x" },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe("unknown_variable");
    expect(outcome.failure.message).toContain("notAVariable");
  });

  it("declares collection variables with empty values so no value lives in the collection", () => {
    const outcome = generateCollection(exportApiModel, approvedTestModel, {
      baseUrl: "https://qa.internal.example",
    });
    if (!outcome.ok) throw new Error("expected a successful export");
    expect(outcome.result.collection.variable.every((variable) => variable.value === "")).toBe(
      true,
    );
  });
});
